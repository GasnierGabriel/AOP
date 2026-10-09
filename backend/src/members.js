// Helpers partagés pour charger rôles, compétitions et profil des membres
const { query } = require('./db');

// LinkedIn facultatif : sans profil renseigné, le lien mène à l'accueil de LinkedIn
const LINKEDIN_HOME = 'https://www.linkedin.com/';

function formatUser(row) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    linkedinUrl: row.linkedin_url || LINKEDIN_HOME,
    hasLinkedin: Boolean(row.linkedin_url),
    status: row.status,
    isBureau: row.is_bureau,
    level: row.level,
    promo: row.promo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Promo : une année plausible, ou null (ex : membre honoraire). undefined = invalide.
const PROMO_MIN = 2015;
const promoMax = () => new Date().getFullYear() + 5;
function cleanPromo(value) {
  if (value === null || value === '') return null;
  const promo = Number(value);
  return Number.isInteger(promo) && promo >= PROMO_MIN && promo <= promoMax() ? promo : undefined;
}
const PROMO_ERROR = () => `Promo invalide (entre ${PROMO_MIN} et ${promoMax()})`;

function groupByUser(rows, format) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.user_id)) map.set(row.user_id, []);
    map.get(row.user_id).push(format(row));
  }
  return map;
}

// Rôle actuel = end_date NULL (ou pas encore atteinte)
async function getRolesByUserIds(userIds, { currentOnly = false } = {}) {
  if (userIds.length === 0) return new Map();
  const { rows } = await query(
    `SELECT ur.id, ur.user_id, ur.role_id, ur.start_date, ur.end_date,
            COALESCE(ur.pole, r.pole) AS pole, r.name, r.description,
            (ur.end_date IS NULL OR ur.end_date >= CURRENT_DATE) AS is_current
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ANY($1::int[])
        ${currentOnly ? 'AND (ur.end_date IS NULL OR ur.end_date >= CURRENT_DATE)' : ''}
      ORDER BY ur.start_date DESC, ur.id DESC`,
    [userIds]
  );
  return groupByUser(rows, (r) => ({
    id: r.id,
    roleId: r.role_id,
    name: r.name,
    description: r.description,
    pole: r.pole,
    startDate: r.start_date,
    endDate: r.end_date,
    isCurrent: r.is_current,
  }));
}

async function getCompetitionsByUserIds(userIds) {
  if (userIds.length === 0) return new Map();
  const { rows } = await query(
    `SELECT uc.id, uc.user_id, uc.competition_id, uc.events, uc.result, uc.comment, c.name, c.year
       FROM user_competitions uc
       JOIN competitions c ON c.id = uc.competition_id
      WHERE uc.user_id = ANY($1::int[])
      ORDER BY c.year DESC, c.name`,
    [userIds]
  );
  return groupByUser(rows, (r) => ({
    id: r.id,
    competitionId: r.competition_id,
    name: r.name,
    year: r.year,
    events: r.events,
    result: r.result,
    comment: r.comment,
  }));
}

async function getTagsByUserIds(userIds) {
  if (userIds.length === 0) return new Map();
  const { rows } = await query(
    `SELECT ut.user_id, t.id, t.name, t.color, t.emoji
       FROM user_tags ut
       JOIN tags t ON t.id = ut.tag_id
      WHERE ut.user_id = ANY($1::int[])
      ORDER BY LOWER(t.name)`,
    [userIds]
  );
  return groupByUser(rows, formatTag);
}

function formatTag(row) {
  return { id: row.id, name: row.name, color: row.color, emoji: row.emoji };
}

async function getProfile(userId) {
  const { rows } = await query(
    'SELECT bio, achievements, updated_at FROM user_profile WHERE user_id = $1',
    [userId]
  );
  const profile = rows[0];
  return {
    bio: profile?.bio || '',
    achievements: profile?.achievements || '',
    updatedAt: profile?.updated_at || null,
  };
}

// Membre complet : infos + historique des rôles + compétitions + tags + profil
async function getFullMember(userRow) {
  const [roles, competitions, tags, profile] = await Promise.all([
    getRolesByUserIds([userRow.id]),
    getCompetitionsByUserIds([userRow.id]),
    getTagsByUserIds([userRow.id]),
    getProfile(userRow.id),
  ]);
  return {
    ...formatUser(userRow),
    roles: roles.get(userRow.id) || [],
    competitions: competitions.get(userRow.id) || [],
    tags: tags.get(userRow.id) || [],
    profile,
  };
}

// LinkedIn : chaîne vide ou null = aucun profil ; undefined = invalide
const LINKEDIN_RE = /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/.+/i;
function cleanLinkedin(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const url = value.trim();
  if (!url) return null;
  return url.length <= 500 && LINKEDIN_RE.test(url) ? url : undefined;
}
const LINKEDIN_ERROR = 'URL LinkedIn invalide (ex : https://www.linkedin.com/in/ton-profil)';

module.exports = {
  cleanLinkedin,
  LINKEDIN_ERROR,
  cleanPromo,
  PROMO_ERROR,
  formatUser,
  getRolesByUserIds,
  getCompetitionsByUserIds,
  getTagsByUserIds,
  formatTag,
  getProfile,
  getFullMember,
};
