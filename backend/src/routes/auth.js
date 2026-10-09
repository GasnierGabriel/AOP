const express = require('express');
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
const { hasSponsoringAccess } = require('../sponsoring');

const router = express.Router();

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
  });
});

// POST /api/auth/signup — le compte est créé en 'prospect' jusqu'à validation du bureau
router.post('/signup', async (req, res) => {
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
router.post('/login', async (req, res) => {
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
  const permissions = {
    canViewDirectory: req.user.is_bureau || req.user.status !== 'prospect',
    canAccessSponsoring: await hasSponsoringAccess(req.user),
  };

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
router.put('/email', authenticateToken, async (req, res) => {
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

// PUT /api/auth/password { currentPassword, newPassword } — déconnecte les autres sessions
router.put('/password', authenticateToken, async (req, res) => {
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

// POST /api/auth/logout — invalide le token côté serveur
router.post('/logout', authenticateToken, async (req, res) => {
  await revokeToken(req.token);
  res.status(204).end();
});

module.exports = router;
