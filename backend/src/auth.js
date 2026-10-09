const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL_DAYS = 7;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET doit être défini');
}
if (process.env.NODE_ENV === 'production' && JWT_SECRET.startsWith('dev_')) {
  throw new Error('JWT_SECRET de développement interdit en production');
}

// Colonnes de users exposables (jamais password_hash)
const USER_FIELDS = [
  'id', 'email', 'full_name', 'linkedin_url', 'status',
  'is_bureau', 'level', 'promo', 'created_at', 'updated_at',
  'google_email', 'google_linked_at',
];

// Adresses de l'école / de l'asso refusées comme identifiant : on demande un mail perso,
// le compte Google Workspace ARECE se lie ensuite pour le SSO.
const BLOCKED_EMAIL_DOMAINS = (process.env.BLOCKED_EMAIL_DOMAINS || 'arece.eu,edu.ece.fr')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

function isBlockedEmail(email = '') {
  const domain = String(email).trim().toLowerCase().split('@').pop();
  return BLOCKED_EMAIL_DOMAINS.includes(domain);
}

const BLOCKED_EMAIL_MESSAGE = `Utilise ton mail perso : les adresses ${BLOCKED_EMAIL_DOMAINS.map((d) => `@${d}`).join(
  ' et '
)} ne sont pas acceptées (ton compte Google ARECE pourra être lié ensuite pour la connexion).`;
const userColumns = (alias) => USER_FIELDS.map((f) => (alias ? `${alias}.${f}` : f)).join(', ');

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function generateToken(userId) {
  // jwtid aléatoire : deux connexions dans la même seconde donnent des tokens distincts
  return jwt.sign({ userId }, JWT_SECRET, {
    expiresIn: `${TOKEN_TTL_DAYS}d`,
    jwtid: crypto.randomUUID(),
  });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// On ne stocke que l'empreinte du token : une fuite de la table ne donne pas de sessions valides.
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Génère un JWT et l'enregistre dans auth_tokens (permet la déconnexion côté serveur)
async function issueToken(userId) {
  const token = generateToken(userId);
  const { exp } = jwt.decode(token);
  await query('DELETE FROM auth_tokens WHERE user_id = $1 AND expires_at <= NOW()', [userId]);
  await query(
    'INSERT INTO auth_tokens (user_id, token, expires_at) VALUES ($1, $2, to_timestamp($3))',
    [userId, hashToken(token), exp]
  );
  return token;
}

async function revokeToken(token) {
  await query('DELETE FROM auth_tokens WHERE token = $1', [hashToken(token)]);
}

// Middleware : Authorization: Bearer <token>
// Recharge l'utilisateur depuis la base à chaque requête pour que les changements
// de statut / niveau / bureau s'appliquent immédiatement.
async function authenticateToken(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentification requise' });
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }

  const { rows } = await query(
    `SELECT ${userColumns('u')}
       FROM auth_tokens t
       JOIN users u ON u.id = t.user_id
      WHERE t.token = $1 AND t.user_id = $2 AND t.expires_at > NOW()`,
    [hashToken(token), payload.userId]
  );
  if (rows.length === 0) {
    return res.status(401).json({ error: 'Session expirée, reconnecte-toi' });
  }

  req.user = rows[0];
  req.token = token;
  next();
}

// Les prospects n'ont aucun accès à l'annuaire tant que le bureau ne les a pas validés
function requireMember(req, res, next) {
  if (req.user.status === 'prospect' && !req.user.is_bureau) {
    return res.status(403).json({
      error: 'Ton compte est en attente de validation par le bureau',
      code: 'PENDING_VALIDATION',
    });
  }
  next();
}

function requireBureau(req, res, next) {
  if (!req.user.is_bureau) {
    return res.status(403).json({ error: 'Réservé aux membres du bureau' });
  }
  next();
}

// Année académique courante : du 1er septembre au 31 août
function getCurrentAcademicYear(date = new Date()) {
  const startYear = date.getMonth() >= 8 ? date.getFullYear() : date.getFullYear() - 1;
  return {
    startYear,
    endYear: startYear + 1,
    startDate: `${startYear}-09-01`,
    endDate: `${startYear + 1}-08-31`,
    label: `${startYear}-${startYear + 1}`,
  };
}

// Un membre "actif de cette année" = statut 'active'. Le bureau repasse les membres
// en 'alumni' à chaque changement d'année académique.
function isActiveThisYear(user) {
  return user.status === 'active';
}

// Règles de visibilité de l'annuaire (rôles d'accès, distincts des rôles ARECE)
function canViewUser(viewer, target) {
  if (!viewer || !target) return false;
  if (viewer.is_bureau) return true;
  if (viewer.status === 'prospect') return false;
  if (viewer.id === target.id) return true;
  if (target.status === 'prospect') return false;

  const level = Number(viewer.level);
  switch (viewer.status) {
    case 'active':
      if (level >= 2) return true;
      return target.is_bureau || isActiveThisYear(target);
    case 'alumni':
      if (level >= 2) return true;
      return target.status === 'alumni';
    case 'honorary':
      // Non spécifié : par prudence, L1 ne voit que lui-même, L2 voit tout
      return level >= 2;
    default:
      return false;
  }
}

// Accès Ask ARECE : 'full' (dont dossier bureau du Drive), 'limited' (sans dossier bureau) ou 'none'
function getAskAreceAccess(user) {
  if (user.is_bureau) return 'full';
  if (user.status === 'prospect') return 'none';
  if (user.status === 'active') return 'limited';
  return Number(user.level) >= 2 ? 'limited' : 'none';
}

module.exports = {
  JWT_SECRET,
  BLOCKED_EMAIL_DOMAINS,
  BLOCKED_EMAIL_MESSAGE,
  isBlockedEmail,
  userColumns,
  hashPassword,
  comparePassword,
  generateToken,
  verifyToken,
  issueToken,
  revokeToken,
  hashToken,
  authenticateToken,
  requireMember,
  requireBureau,
  getCurrentAcademicYear,
  canViewUser,
  getAskAreceAccess,
};
