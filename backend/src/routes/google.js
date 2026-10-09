// Routes du SSO Google ARECE : liaison d'un compte (depuis « Informations de connexion »)
// puis connexion en un clic. Flux « authorization code » côté serveur.
const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { JWT_SECRET, authenticateToken, issueToken } = require('../auth');
const google = require('../google');

const router = express.Router();

// Le nonce en cookie lie le retour de Google au navigateur qui a lancé la demande
// (empêche de faire lier / connecter quelqu'un à son insu).
const NONCE_COOKIE = 'arece_google_nonce';
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax', // envoyé lors de la redirection (GET de premier niveau) depuis Google
  secure: google.PUBLIC_URL.startsWith('https://'),
  path: '/api/auth/google',
};

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  const match = header.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

// Retour vers le site avec un code d'erreur affiché par le frontend
function backToSite(res, mode, code) {
  const page = mode === 'link' ? '/connexion' : '/login';
  res.redirect(`${google.PUBLIC_URL}${page}?google=${encodeURIComponent(code)}`);
}

// POST /api/auth/google/link-ticket — ticket de 2 min pour lancer la liaison par simple redirection
router.post('/link-ticket', authenticateToken, (req, res) => {
  if (!google.isEnabled()) return res.status(503).json({ error: "La connexion Google n'est pas encore configurée" });
  const ticket = jwt.sign({ purpose: 'google-link', userId: req.user.id }, JWT_SECRET, { expiresIn: '2m' });
  res.json({ ticket });
});

// GET /api/auth/google/start?mode=login|link[&ticket=…] — redirige vers Google
router.get('/start', (req, res) => {
  const mode = req.query.mode === 'link' ? 'link' : 'login';
  if (!google.isEnabled()) return backToSite(res, mode, 'disabled');

  let userId = null;
  if (mode === 'link') {
    try {
      const ticket = jwt.verify(String(req.query.ticket || ''), JWT_SECRET);
      if (ticket.purpose !== 'google-link') throw new Error('ticket invalide');
      userId = ticket.userId;
    } catch {
      return backToSite(res, mode, 'expired');
    }
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  const state = jwt.sign({ purpose: 'google-state', mode, userId, nonce }, JWT_SECRET, { expiresIn: '10m' });
  res.cookie(NONCE_COOKIE, nonce, { ...COOKIE_OPTIONS, maxAge: 10 * 60 * 1000 });
  res.redirect(google.authorizationUrl(state));
});

// GET /api/auth/google/callback?code&state — retour de Google
router.get('/callback', async (req, res) => {
  let state;
  try {
    state = jwt.verify(String(req.query.state || ''), JWT_SECRET);
    if (state.purpose !== 'google-state') throw new Error('state invalide');
  } catch {
    return backToSite(res, 'login', 'expired');
  }
  const { mode } = state;

  const nonce = readCookie(req, NONCE_COOKIE);
  res.clearCookie(NONCE_COOKIE, COOKIE_OPTIONS);
  if (!nonce || nonce !== state.nonce) return backToSite(res, mode, 'expired');
  if (req.query.error || !req.query.code) return backToSite(res, mode, 'cancelled');

  let identity;
  try {
    identity = await google.exchangeCode(String(req.query.code));
  } catch (err) {
    console.error('Connexion Google :', err.message);
    return backToSite(res, mode, 'failed');
  }
  if (!google.belongsToWorkspace(identity)) return backToSite(res, mode, 'domain');

  if (mode === 'link') {
    try {
      const { rowCount } = await query(
        `UPDATE users SET google_sub = $2, google_email = $3, google_linked_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [state.userId, identity.sub, identity.email]
      );
      if (rowCount === 0) return backToSite(res, mode, 'failed');
    } catch (err) {
      if (err.code === '23505') return backToSite(res, mode, 'taken'); // déjà lié à un autre compte
      throw err;
    }
    return res.redirect(`${google.PUBLIC_URL}/connexion?google=linked`);
  }

  const { rows } = await query('SELECT id FROM users WHERE google_sub = $1', [identity.sub]);
  if (rows.length === 0) return backToSite(res, mode, 'unknown');
  await query('UPDATE users SET google_email = $2 WHERE id = $1', [rows[0].id, identity.email]);

  // Jeton dans le fragment (#) : jamais envoyé aux serveurs, effacé de l'URL par le frontend
  const token = await issueToken(rows[0].id);
  res.redirect(`${google.PUBLIC_URL}/login/google#token=${encodeURIComponent(token)}`);
});

// DELETE /api/auth/google — dissocier son compte Google
router.delete('/', authenticateToken, async (req, res) => {
  await query(
    'UPDATE users SET google_sub = NULL, google_email = NULL, google_linked_at = NULL, updated_at = NOW() WHERE id = $1',
    [req.user.id]
  );
  res.status(204).end();
});

module.exports = router;
