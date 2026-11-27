const crypto = require('crypto');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { query, pool } = require('../db');
const {
  BLOCKED_EMAIL_DOMAINS,
  BLOCKED_EMAIL_MESSAGE,
  isBlockedEmail,
  userColumns,
  hashPassword,
  comparePassword,
  issueToken,
  revokeToken,
  hashToken,
  authenticateToken,
  getCurrentAcademicYear,
  getAskAreceAccess,
  canViewGallery,
  canManageGallery,
} = require('../auth');
const {
  cleanLinkedin,
  LINKEDIN_ERROR,
  cleanPromo,
  PROMO_ERROR,
  formatUser,
  getFullMember,
} = require('../members');
const google = require('../google');
const mailer = require('../mailer');
const { hasSponsoringAccess, countUrgentCounterparts } = require('../sponsoring');

const router = express.Router();

// Limites de débit par adresse IP contre les essais de mots de passe et les abus d'envoi de mails
const limit = (max, windowMinutes, error) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error }),
  });
const loginLimit = limit(20, 15, 'Trop de tentatives de connexion : réessaie dans quelques minutes.');
const signupLimit = limit(10, 60, "Trop d'inscriptions depuis cette connexion : réessaie plus tard.");
const resetMailLimit = limit(5, 15, 'Trop de demandes de réinitialisation : réessaie dans quelques minutes.');
const resetLimit = limit(30, 15, 'Trop de tentatives : réessaie dans quelques minutes.');

// Le niveau d'accès (1/2) n'est communiqué qu'aux membres du bureau
function selfView(row) {
  const user = formatUser(row);
  if (!row.is_bureau) delete user.level;
  return user;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

function validateEmail(email) {
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim()) || email.length > 255) return 'Email invalide';
  if (isBlockedEmail(email)) return BLOCKED_EMAIL_MESSAGE;
  return null;
}

function validateSignup({ email, password, fullName, linkedinUrl, promo }) {
  const emailError = validateEmail(email);
  if (emailError) return emailError;
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères`;
  }
  if (typeof fullName !== 'string' || !fullName.trim() || fullName.length > 255) {
    return 'Nom complet requis';
  }
  // LinkedIn facultatif
  if (cleanLinkedin(linkedinUrl) === undefined) return LINKEDIN_ERROR;
  // Promo facultative (les membres honoraires n'en ont pas)
  if (promo !== undefined && cleanPromo(promo) === undefined) return PROMO_ERROR();
  return null;
}

async function checkPassword(userId, password) {
  if (typeof password !== 'string') return false;
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  return rows.length > 0 && comparePassword(password, rows[0].password_hash);
}

// GET /api/auth/config — options d'interface publiques (connexion Google disponible ?)
router.get('/config', (req, res) => {
  res.json({
    google: { enabled: google.isEnabled(), domain: google.DOMAIN },
    blockedEmailDomains: BLOCKED_EMAIL_DOMAINS,
    passwordReset: mailer.isEnabled(), // lien « Mot de passe oublié » affiché si l'envoi de mails est configuré
  });
});

// POST /api/auth/signup — le compte est créé en 'prospect' jusqu'à validation du bureau
router.post('/signup', signupLimit, async (req, res) => {
  const body = req.body || {};
  const error = validateSignup(body);
  if (error) return res.status(400).json({ error });

  const passwordHash = await hashPassword(body.password);
  const client = await pool.connect();
  let user;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, full_name, linkedin_url, promo)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${userColumns()}`,
      [
        body.email.trim().toLowerCase(),
        passwordHash,
        body.fullName.trim(),
        cleanLinkedin(body.linkedinUrl),
        body.promo === undefined ? null : cleanPromo(body.promo),
      ]
    );
    user = rows[0];
    await client.query('INSERT INTO user_profile (user_id) VALUES ($1)', [user.id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Un compte existe déjà avec cet email' });
    }
    throw err;
  } finally {
    client.release();
  }

  const token = await issueToken(user.id);
  res.status(201).json({ user: selfView(user), token });
});

// POST /api/auth/login — mail perso + mot de passe (les adresses ARECE / ECE passent par Google)
router.post('/login', loginLimit, async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email et mot de passe requis' });
  }
  if (isBlockedEmail(email)) {
    return res.status(400).json({
      error: `Connexion impossible avec une adresse ${BLOCKED_EMAIL_DOMAINS.map((d) => `@${d}`).join(
        ' ou '
      )} : utilise ton mail perso, ou « Se connecter avec Google ».`,
      code: 'BLOCKED_EMAIL_DOMAIN',
    });
  }

  const { rows } = await query(
    `SELECT ${userColumns()}, password_hash FROM users WHERE LOWER(email) = LOWER($1)`,
    [email.trim()]
  );
  const user = rows[0];
  if (!user || !(await comparePassword(password, user.password_hash))) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  }

  const token = await issueToken(user.id);
  res.json({ user: selfView(user), token });
});

// GET /api/auth/me — utilisateur courant + rôles + compétitions + profil + connexion Google
// Le niveau d'accès (1/2) n'est communiqué qu'aux membres du bureau.
router.get('/me', authenticateToken, async (req, res) => {
  const user = await getFullMember(req.user);
  user.google = {
    linked: Boolean(req.user.google_email),
    email: req.user.google_email,
    linkedAt: req.user.google_linked_at,
  };
  // Ancien compte créé avec une adresse ARECE / ECE : il doit passer à un mail perso
  user.emailNeedsUpdate = isBlockedEmail(req.user.email);
  user.notifications = {
    taskReminders: req.user.notify_task_reminders !== false,
    weeklyDigest: req.user.notify_weekly_digest !== false,
    taskAssigned: req.user.notify_task_assigned !== false,
  };
  const permissions = {
    canViewDirectory: req.user.is_bureau || req.user.status !== 'prospect',
    canAccessSponsoring: await hasSponsoringAccess(req.user),
    canViewGallery: canViewGallery(req.user),
    canManageGallery: canManageGallery(req.user),
  };
  if (permissions.canAccessSponsoring) permissions.urgentCounterparts = await countUrgentCounterparts();
  if (permissions.canViewDirectory) {
    // Mes tâches non faites, en retard ou à échéance sous 3 jours (badge « Tâches » du menu)
    const { rows } = await query(
      `SELECT COUNT(DISTINCT t.id)::int AS count
         FROM tasks t JOIN task_assignees a ON a.task_id = t.id
        WHERE a.user_id = $1 AND t.status <> 'done' AND t.due_date IS NOT NULL AND t.due_date <= CURRENT_DATE + 3`,
      [req.user.id]
    );
    permissions.myUrgentTasks = rows[0].count;
  }

  if (req.user.is_bureau) {
    permissions.askArece = getAskAreceAccess(req.user);
    const { rows } = await query("SELECT COUNT(*)::int AS count FROM users WHERE status = 'prospect'");
    permissions.pendingProspects = rows[0].count;
  } else {
    delete user.level;
  }

  res.json({ user, permissions, academicYear: getCurrentAcademicYear().label });
});

// PUT /api/auth/email { email, currentPassword } — changer son mail perso de connexion
router.put('/email', authenticateToken, loginLimit, async (req, res) => {
  const { email, currentPassword } = req.body || {};
  const error = validateEmail(email);
  if (error) return res.status(400).json({ error });
  if (!(await checkPassword(req.user.id, currentPassword))) {
    return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
  }

  try {
    const { rows } = await query(
      `UPDATE users SET email = $2, updated_at = NOW() WHERE id = $1 RETURNING ${userColumns()}`,
      [req.user.id, email.trim().toLowerCase()]
    );
    res.json({ user: selfView(rows[0]) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un compte existe déjà avec cet email' });
    throw err;
  }
});

// PUT /api/auth/notifications { taskReminders?, weeklyDigest?, taskAssigned? } — préférences de notification par mail
const NOTIFICATION_COLUMNS = { taskReminders: 'notify_task_reminders', weeklyDigest: 'notify_weekly_digest', taskAssigned: 'notify_task_assigned' };
router.put('/notifications', authenticateToken, async (req, res) => {
  const body = req.body || {};
  const keys = Object.keys(NOTIFICATION_COLUMNS).filter((k) => body[k] !== undefined);
  if (keys.length === 0 || keys.some((k) => typeof body[k] !== 'boolean')) {
    return res.status(400).json({ error: 'Préférence invalide' });
  }
  const { rows } = await query(
    `UPDATE users SET ${keys.map((k, i) => `${NOTIFICATION_COLUMNS[k]} = $${i + 2}`).join(', ')}
      WHERE id = $1 RETURNING ${Object.values(NOTIFICATION_COLUMNS).join(', ')}`,
    [req.user.id, ...keys.map((k) => body[k])]
  );
  const notifications = Object.fromEntries(Object.entries(NOTIFICATION_COLUMNS).map(([k, col]) => [k, rows[0][col]]));
  res.json({ notifications });
});

// PUT /api/auth/password { currentPassword, newPassword } — déconnecte les autres sessions
router.put('/password', authenticateToken, loginLimit, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Le nouveau mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères` });
  }
  if (!(await checkPassword(req.user.id, currentPassword))) {
    return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
  }

  await query('UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1', [
    req.user.id,
    await hashPassword(newPassword),
  ]);
  const { rowCount } = await query('DELETE FROM auth_tokens WHERE user_id = $1 AND token <> $2', [
    req.user.id,
    hashToken(req.token),
  ]);
  res.json({ otherSessionsClosed: rowCount });
});

/* ---------- Mot de passe oublié ---------- */

const RESET_TTL_MINUTES = 60;
const RESET_MAX_PER_HOUR = 3; // mails de réinitialisation par compte et par heure
const IP_MAX_PER_HOUR = 10; // demandes par adresse IP et par heure
const FORGOT_MESSAGE =
  'Si un compte existe avec cette adresse, un mail avec un lien de réinitialisation vient de partir. Pense à regarder dans les spams.';

// Limite simple en mémoire par IP (l'API est derrière Caddy, qui transmet l'IP du visiteur)
const ipHits = new Map();
function tooManyFromIp(req) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < 3600 * 1000);
  hits.push(now);
  ipHits.set(ip, hits);
  if (ipHits.size > 5000) ipHits.clear(); // garde-fou mémoire
  return hits.length > IP_MAX_PER_HOUR;
}

async function sendResetMail(email) {
  const { rows } = await query('SELECT id, full_name, email FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  const user = rows[0];
  if (!user) return;
  const { rows: recent } = await query(
    "SELECT COUNT(*)::int AS n FROM password_resets WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'",
    [user.id]
  );
  if (recent[0].n >= RESET_MAX_PER_HOUR) return;

  // Un seul lien valable à la fois : les précédents sont invalidés
  const token = crypto.randomBytes(32).toString('base64url');
  await query('UPDATE password_resets SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [user.id]);
  await query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '${RESET_TTL_MINUTES} minutes')`,
    [user.id, hashToken(token)]
  );

  const url = `${mailer.PUBLIC_URL}/reinitialiser-mot-de-passe?token=${token}`;
  const firstName = user.full_name.split(' ')[0];
  const { text, html } = mailer.layout({
    title: 'Réinitialiser ton mot de passe',
    paragraphs: [
      `Bonjour ${firstName},`,
      "Quelqu'un (sans doute toi) a demandé à réinitialiser le mot de passe de ton compte sur Périclès.",
      `Ce lien est valable ${RESET_TTL_MINUTES} minutes et ne fonctionne qu'une fois.`,
    ],
    button: { label: 'Choisir un nouveau mot de passe', url },
    footer: "Tu n'as rien demandé ? Ignore ce mail : ton mot de passe actuel reste valable.",
  });
  await mailer.sendMail({ to: user.email, subject: 'Périclès · Réinitialisation de ton mot de passe', text, html });
}

// POST /api/auth/forgot-password { email } — réponse identique que le compte existe ou non
router.post('/forgot-password', resetMailLimit, async (req, res) => {
  if (!mailer.isEnabled()) {
    return res.status(503).json({
      error: "La réinitialisation par mail n'est pas encore disponible : contacte un membre du bureau.",
    });
  }
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  if (!EMAIL_RE.test(email) || email.length > 255) return res.status(400).json({ error: 'Email invalide' });
  if (isBlockedEmail(email)) {
    return res.status(400).json({
      error: `Les adresses ${BLOCKED_EMAIL_DOMAINS.map((d) => `@${d}`).join(' et ')} ne servent pas d'identifiant : indique le mail perso de ton compte.`,
    });
  }
  if (tooManyFromIp(req)) {
    return res.status(429).json({ error: 'Trop de demandes, réessaie dans une heure.' });
  }

  // Envoi après la réponse : même délai que le compte existe ou non
  res.json({ message: FORGOT_MESSAGE });
  sendResetMail(email).catch((err) => console.error('Envoi du mail de réinitialisation impossible :', err.message));
});

async function findReset(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const { rows } = await query(
    `SELECT r.id, r.user_id FROM password_resets r
      WHERE r.token_hash = $1 AND r.used_at IS NULL AND r.expires_at > NOW()`,
    [hashToken(token)]
  );
  return rows[0] || null;
}
const INVALID_RESET = {
  error: 'Ce lien de réinitialisation est invalide ou a expiré : refais une demande.',
  code: 'INVALID_RESET_TOKEN',
};

// GET /api/auth/reset-password?token= — le lien est-il encore valable ?
router.get('/reset-password', resetLimit, async (req, res) => {
  const reset = await findReset(req.query.token);
  if (!reset) return res.status(400).json(INVALID_RESET);
  res.json({ valid: true });
});

// POST /api/auth/reset-password { token, password } — nouveau mot de passe, toutes les sessions fermées, connexion
router.post('/reset-password', resetLimit, async (req, res) => {
  const { token, password } = req.body || {};
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères` });
  }
  const passwordHash = await hashPassword(password);

  const client = await pool.connect();
  let userId;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, user_id FROM password_resets
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW() FOR UPDATE`,
      [typeof token === 'string' ? hashToken(token) : '']
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json(INVALID_RESET);
    }
    userId = rows[0].user_id;
    await client.query('UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1', [userId, passwordHash]);
    await client.query('UPDATE password_resets SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [userId]);
    await client.query('DELETE FROM auth_tokens WHERE user_id = $1', [userId]); // déconnecte les autres appareils
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  res.json({ token: await issueToken(userId) });
});

// POST /api/auth/logout — invalide le token côté serveur
router.post('/logout', authenticateToken, async (req, res) => {
  await revokeToken(req.token);
  res.status(204).end();
});

module.exports = router;
