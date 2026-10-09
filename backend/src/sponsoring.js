// Accès à l'ERP Sponsoring : membres du bureau, ou membres portant le tag « Sponsoring »
const { query } = require('./db');

const SPONSORING_TAG = 'sponsoring';

async function hasSponsoringAccess(user) {
  if (!user) return false;
  if (user.is_bureau) return true;
  if (user.status === 'prospect') return false;
  const { rowCount } = await query(
    `SELECT 1 FROM user_tags ut JOIN tags t ON t.id = ut.tag_id
      WHERE ut.user_id = $1 AND LOWER(TRIM(t.name)) = $2`,
    [user.id, SPONSORING_TAG]
  );
  return rowCount > 0;
}

async function requireSponsoring(req, res, next) {
  if (!(await hasSponsoringAccess(req.user))) {
    return res.status(403).json({ error: 'Réservé au bureau et aux membres du pôle Sponsoring' });
  }
  next();
}

module.exports = { SPONSORING_TAG, hasSponsoringAccess, requireSponsoring };
