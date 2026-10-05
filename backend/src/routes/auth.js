const express = require('express');
const { query, pool } = require('../db');
const {
  userColumns,
  hashPassword,
  comparePassword,
  issueToken,
  revokeToken,
  authenticateToken,
  getCurrentAcademicYear,
  getAskAreceAccess,
} = require('../auth');
const { formatUser, getFullMember } = require('../members');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LINKEDIN_RE = /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/.+/i;

function validateSignup({ email, password, fullName, linkedinUrl }) {
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) return 'Email invalide';
  if (typeof password !== 'string' || password.length < 8) {
    return 'Le mot de passe doit contenir au moins 8 caractères';
  }
  if (typeof fullName !== 'string' || !fullName.trim() || fullName.length > 255) {
    return 'Nom complet requis';
  }
  if (typeof linkedinUrl !== 'string' || !LINKEDIN_RE.test(linkedinUrl.trim())) {
    return 'URL LinkedIn invalide (ex : https://www.linkedin.com/in/ton-profil)';
  }
  return null;
}

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
      `INSERT INTO users (email, password_hash, full_name, linkedin_url)
       VALUES ($1, $2, $3, $4)
       RETURNING ${userColumns()}`,
      [body.email.trim().toLowerCase(), passwordHash, body.fullName.trim(), body.linkedinUrl.trim()]
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
  res.status(201).json({ user: formatUser(user), token });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email et mot de passe requis' });
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
  res.json({ user: formatUser(user), token });
});

// GET /api/auth/me — utilisateur courant + rôles + compétitions + profil
router.get('/me', authenticateToken, async (req, res) => {
  const user = await getFullMember(req.user);
  res.json({
    user,
    permissions: {
      canViewDirectory: req.user.is_bureau || req.user.status !== 'prospect',
      askArece: getAskAreceAccess(req.user),
    },
    academicYear: getCurrentAcademicYear().label,
  });
});

// POST /api/auth/logout — invalide le token côté serveur
router.post('/logout', authenticateToken, async (req, res) => {
  await revokeToken(req.token);
  res.status(204).end();
});

module.exports = router;
