// Parcours d'un membre : historique des rôles et compétitions.
// Chacun peut modifier le sien ; le bureau peut modifier celui de tout le monde.
const { query } = require('../db');
const { getRolesByUserIds, getCompetitionsByUserIds } = require('../members');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Texte nettoyé (espaces multiples réduits) ; null si vide ; undefined si invalide
function cleanText(value, max, { required = false } = {}) {
  if (value === undefined || value === null || value === '') return required ? undefined : null;
  if (typeof value !== 'string') return undefined;
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text) return required ? undefined : null;
  return text.length <= max ? text : undefined;
}

function cleanDate(value, { required = false } = {}) {
  if (value === undefined || value === null || value === '') return required ? undefined : null;
  if (typeof value !== 'string' || !DATE_RE.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value) ? value : undefined;
}

function cleanYear(value) {
  const year = Number(value);
  const max = new Date().getFullYear() + 2;
  return Number.isInteger(year) && year >= 2000 && year <= max ? year : undefined;
}

// Classement (1 = 1er) ; null si non renseigné
function cleanResult(value) {
  if (value === undefined || value === null || value === '') return null;
  const rank = Number(value);
  return Number.isInteger(rank) && rank >= 1 && rank <= 999 ? rank : undefined;
}

// Épreuves préparées [{ name, rank }] : dédoublonnées sans tenir compte de la casse
const MAX_EVENTS = 12;
function cleanEvents(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_EVENTS) return undefined;
  const seen = new Set();
  const events = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return undefined;
    const name = cleanText(item.name, 60, { required: true });
    const rank = cleanResult(item.rank);
    if (name === undefined || rank === undefined) return undefined;
    if (!seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      events.push({ name, rank });
    }
  }
  return events;
}

const MAX_COMMENT_LENGTH = 1000;
function cleanComment(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > MAX_COMMENT_LENGTH) return undefined;
  return value.trim() || null;
}

// Le membre lui-même ou le bureau
function requireSelfOrBureau(req, res, next) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
  if (req.user.id !== id && !req.user.is_bureau) {
    return res.status(403).json({ error: 'Tu ne peux modifier que ton propre parcours' });
  }
  req.memberId = id;
  next();
}

async function findOrCreate(select, insert) {
  let { rows } = await query(...select);
  if (rows.length) return rows[0].id;
  ({ rows } = await query(...insert));
  if (rows.length) return rows[0].id;
  ({ rows } = await query(...select)); // créé en parallèle
  return rows[0].id;
}

const findOrCreateRole = (name, pole) =>
  findOrCreate(
    ['SELECT id FROM roles WHERE LOWER(name) = LOWER($1)', [name]],
    ['INSERT INTO roles (name, pole) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id', [name, pole]]
  );

const findOrCreateCompetition = (name, year) =>
  findOrCreate(
    ['SELECT id FROM competitions WHERE LOWER(name) = LOWER($1) AND year = $2', [name, year]],
    ['INSERT INTO competitions (name, year) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id', [name, year]]
  );

async function userExists(id) {
  const { rowCount } = await query('SELECT 1 FROM users WHERE id = $1', [id]);
  return rowCount > 0;
}

async function sendRoles(res, memberId, status = 200) {
  const roles = await getRolesByUserIds([memberId]);
  res.status(status).json({ roles: roles.get(memberId) || [] });
}

async function sendCompetitions(res, memberId, status = 200) {
  const competitions = await getCompetitionsByUserIds([memberId]);
  res.status(status).json({ competitions: competitions.get(memberId) || [] });
}

function validateRole(body, { partial }) {
  const values = {};
  if (body.name !== undefined || !partial) {
    values.name = cleanText(body.name, 150, { required: true });
    if (values.name === undefined) return { error: 'Intitulé du rôle requis (150 caractères max)' };
  }
  if (body.pole !== undefined || !partial) {
    values.pole = cleanText(body.pole, 100);
    if (values.pole === undefined) return { error: 'Pôle invalide (100 caractères max)' };
  }
  if (body.startDate !== undefined || !partial) {
    values.startDate = cleanDate(body.startDate, { required: true });
    if (values.startDate === undefined) return { error: 'Date de début invalide' };
  }
  if (body.endDate !== undefined || !partial) {
    values.endDate = cleanDate(body.endDate);
    if (values.endDate === undefined) return { error: 'Date de fin invalide' };
  }
  // Vérifié ici (en plus de la contrainte SQL) pour ne rien créer dans le catalogue en cas d'erreur
  if (values.startDate && values.endDate && values.endDate < values.startDate) {
    return { error: 'La date de fin doit être après la date de début' };
  }
  return { values };
}

function validateCompetition(body, { partial }) {
  const values = {};
  if (body.name !== undefined || !partial) {
    values.name = cleanText(body.name, 200, { required: true });
    if (values.name === undefined) return { error: 'Nom de la compétition requis (200 caractères max)' };
  }
  if (body.year !== undefined || !partial) {
    values.year = cleanYear(body.year);
    if (values.year === undefined) return { error: 'Année invalide' };
  }
  if ((values.name === undefined) !== (values.year === undefined)) {
    return { error: 'Le nom et l’année de la compétition vont ensemble' };
  }
  if (values.name !== undefined) {
    // L'année est saisie à part : « Formula Student UK 2026 » devient « Formula Student UK »
    values.name = values.name.replace(new RegExp(`\\s*[-–]?\\s*${values.year}$`), '').trim() || values.name;
  }
  if (body.events !== undefined || !partial) {
    values.events = cleanEvents(body.events);
    if (values.events === undefined) {
      return { error: `Épreuves invalides (${MAX_EVENTS} max, nom de 60 caractères, classement à partir de 1)` };
    }
  }
  if (body.result !== undefined || !partial) {
    values.result = cleanResult(body.result);
    if (values.result === undefined) return { error: 'Classement invalide (1 = 1er)' };
  }
  if (body.comment !== undefined || !partial) {
    values.comment = cleanComment(body.comment);
    if (values.comment === undefined) return { error: `Commentaire trop long (${MAX_COMMENT_LENGTH} caractères max)` };
  }
  return { values };
}

function handleConstraintError(err, res, messages) {
  if (err.code === '23514') return res.status(400).json({ error: 'La date de fin doit être après la date de début' });
  if (err.code === '23505') return res.status(409).json({ error: messages.duplicate });
  throw err;
}

module.exports = function registerCareerRoutes(router) {
  // GET /api/annuaire/catalog — suggestions de saisie (rôles, pôles, compétitions)
  router.get('/catalog', async (req, res) => {
    const [roles, poles, competitions] = await Promise.all([
      query('SELECT id, name, pole FROM roles ORDER BY LOWER(name)'),
      query(
        `SELECT DISTINCT pole FROM (
           SELECT pole FROM roles UNION SELECT pole FROM user_roles
         ) p WHERE pole IS NOT NULL ORDER BY pole`
      ),
      query('SELECT id, name, year FROM competitions ORDER BY year DESC, LOWER(name)'),
    ]);
    res.json({
      roles: roles.rows,
      poles: poles.rows.map((r) => r.pole),
      competitions: competitions.rows,
    });
  });

  // POST /api/annuaire/members/:id/roles { name, pole, startDate, endDate }
  router.post('/members/:id/roles', requireSelfOrBureau, async (req, res) => {
    const { values, error } = validateRole(req.body || {}, { partial: false });
    if (error) return res.status(400).json({ error });
    if (!(await userExists(req.memberId))) return res.status(404).json({ error: 'Membre introuvable' });

    const roleId = await findOrCreateRole(values.name, values.pole);
    try {
      await query(
        'INSERT INTO user_roles (user_id, role_id, pole, start_date, end_date) VALUES ($1, $2, $3, $4, $5)',
        [req.memberId, roleId, values.pole, values.startDate, values.endDate]
      );
    } catch (err) {
      return handleConstraintError(err, res, { duplicate: 'Ce rôle existe déjà' });
    }
    await sendRoles(res, req.memberId, 201);
  });

  // PATCH /api/annuaire/members/:id/roles/:entryId { name?, pole?, startDate?, endDate? }
  router.patch('/members/:id/roles/:entryId', requireSelfOrBureau, async (req, res) => {
    const entryId = parseId(req.params.entryId);
    if (!entryId) return res.status(400).json({ error: 'Identifiant invalide' });
    const { values, error } = validateRole(req.body || {}, { partial: true });
    if (error) return res.status(400).json({ error });

    const sets = [];
    const params = [entryId, req.memberId];
    const set = (column, value) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    if (values.name !== undefined) set('role_id', await findOrCreateRole(values.name, values.pole ?? null));
    if (values.pole !== undefined) set('pole', values.pole);
    if (values.startDate !== undefined) set('start_date', values.startDate);
    if (values.endDate !== undefined) set('end_date', values.endDate);
    if (sets.length === 0) return res.status(400).json({ error: 'Rien à modifier' });

    try {
      const { rowCount } = await query(
        `UPDATE user_roles SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2`,
        params
      );
      if (rowCount === 0) return res.status(404).json({ error: 'Rôle introuvable' });
    } catch (err) {
      return handleConstraintError(err, res, { duplicate: 'Ce rôle existe déjà' });
    }
    await sendRoles(res, req.memberId);
  });

  // DELETE /api/annuaire/members/:id/roles/:entryId
  router.delete('/members/:id/roles/:entryId', requireSelfOrBureau, async (req, res) => {
    const entryId = parseId(req.params.entryId);
    if (!entryId) return res.status(400).json({ error: 'Identifiant invalide' });
    const { rowCount } = await query('DELETE FROM user_roles WHERE id = $1 AND user_id = $2', [
      entryId,
      req.memberId,
    ]);
    if (rowCount === 0) return res.status(404).json({ error: 'Rôle introuvable' });
    await sendRoles(res, req.memberId);
  });

  // POST /api/annuaire/members/:id/competitions { name, year, events[{ name, rank }], result, comment }
  router.post('/members/:id/competitions', requireSelfOrBureau, async (req, res) => {
    const { values, error } = validateCompetition(req.body || {}, { partial: false });
    if (error) return res.status(400).json({ error });
    if (!(await userExists(req.memberId))) return res.status(404).json({ error: 'Membre introuvable' });

    const competitionId = await findOrCreateCompetition(values.name, values.year);
    try {
      await query(
        `INSERT INTO user_competitions (user_id, competition_id, events, result, comment)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.memberId, competitionId, JSON.stringify(values.events), values.result, values.comment]
      );
    } catch (err) {
      return handleConstraintError(err, res, { duplicate: 'Cette compétition est déjà dans le parcours' });
    }
    await sendCompetitions(res, req.memberId, 201);
  });

  // PATCH /api/annuaire/members/:id/competitions/:entryId { name?, year?, events?, result?, comment? }
  router.patch('/members/:id/competitions/:entryId', requireSelfOrBureau, async (req, res) => {
    const entryId = parseId(req.params.entryId);
    if (!entryId) return res.status(400).json({ error: 'Identifiant invalide' });
    const { values, error } = validateCompetition(req.body || {}, { partial: true });
    if (error) return res.status(400).json({ error });

    const sets = [];
    const params = [entryId, req.memberId];
    const set = (column, value) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    if (values.name !== undefined) set('competition_id', await findOrCreateCompetition(values.name, values.year));
    if (values.events !== undefined) set('events', JSON.stringify(values.events));
    if (values.result !== undefined) set('result', values.result);
    if (values.comment !== undefined) set('comment', values.comment);
    if (sets.length === 0) return res.status(400).json({ error: 'Rien à modifier' });

    try {
      const { rowCount } = await query(
        `UPDATE user_competitions SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2`,
        params
      );
      if (rowCount === 0) return res.status(404).json({ error: 'Compétition introuvable' });
    } catch (err) {
      return handleConstraintError(err, res, { duplicate: 'Cette compétition est déjà dans le parcours' });
    }
    await sendCompetitions(res, req.memberId);
  });

  // DELETE /api/annuaire/members/:id/competitions/:entryId
  router.delete('/members/:id/competitions/:entryId', requireSelfOrBureau, async (req, res) => {
    const entryId = parseId(req.params.entryId);
    if (!entryId) return res.status(400).json({ error: 'Identifiant invalide' });
    const { rowCount } = await query('DELETE FROM user_competitions WHERE id = $1 AND user_id = $2', [
      entryId,
      req.memberId,
    ]);
    if (rowCount === 0) return res.status(404).json({ error: 'Compétition introuvable' });
    await sendCompetitions(res, req.memberId);
  });
};
