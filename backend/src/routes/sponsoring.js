// ERP Sponsoring : suivi des partenaires (bureau + membres tagués « Sponsoring »)
const express = require('express');
const { query, pool } = require('../db');
const { authenticateToken } = require('../auth');
const { SPONSORING_TAG, requireSponsoring } = require('../sponsoring');

const router = express.Router();
router.use(authenticateToken, requireSponsoring);

const STATUSES = ['to_contact', 'contacted', 'negotiation', 'signed', 'declined'];
const CONTRIBUTION_TYPES = ['money', 'material', 'service', 'mixed'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/\S+\.\S+/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const TIER_REQUIRED = { error: 'Indique le rang du partenaire signé (Bronze, Argent, Or, Platine…)', code: 'TIER_REQUIRED' };

const SELECT_SPONSORS = `
  SELECT s.*, o.full_name AS owner_name,
         t.name AS tier_name, t.color AS tier_color, t.position AS tier_position
    FROM sponsors s
    LEFT JOIN users o ON o.id = s.owner_id
    LEFT JOIN sponsor_tiers t ON t.id = s.tier_id`;

const formatTier = (r) => ({ id: r.id, name: r.name, color: r.color, position: r.position });

const formatCounterpart = (r) => ({
  id: r.id,
  label: r.label,
  details: r.details || '',
  dueDate: r.due_date,
  done: Boolean(r.done_at),
  doneAt: r.done_at,
});

// Contreparties des partenaires demandés, groupées par partenaire
async function counterpartsBySponsor(sponsorIds) {
  const map = new Map(sponsorIds.map((id) => [id, []]));
  if (sponsorIds.length === 0) return map;
  const { rows } = await query(
    'SELECT * FROM sponsor_counterparts WHERE sponsor_id = ANY($1::int[]) ORDER BY position, id',
    [sponsorIds]
  );
  for (const row of rows) map.get(row.sponsor_id)?.push(formatCounterpart(row));
  return map;
}

function formatSponsor(row, counterparts = []) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    contributionType: row.contribution_type,
    amount: row.amount === null ? null : Number(row.amount),
    contributionDetails: row.contribution_details || '',
    contactName: row.contact_name || '',
    contactRole: row.contact_role || '',
    contactEmail: row.contact_email || '',
    contactPhone: row.contact_phone || '',
    website: row.website || '',
    owner: row.owner_id ? { id: row.owner_id, fullName: row.owner_name } : null,
    ownerExternal: row.owner_external || '', // responsable hors équipe, saisi à la main
    tier: row.tier_id
      ? { id: row.tier_id, name: row.tier_name, color: row.tier_color, position: row.tier_position }
      : null,
    nextActionDate: row.next_action_date,
    notes: row.notes || '',
    counterparts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Membres pouvant être responsables d'un partenaire (= ceux qui ont accès au Sponsoring)
async function sponsoringTeam() {
  const { rows } = await query(
    `SELECT DISTINCT u.id, u.full_name
       FROM users u
       LEFT JOIN user_tags ut ON ut.user_id = u.id
       LEFT JOIN tags t ON t.id = ut.tag_id
      WHERE u.is_bureau OR (u.status <> 'prospect' AND LOWER(TRIM(t.name)) = $1)
      ORDER BY u.full_name`,
    [SPONSORING_TAG]
  );
  return rows.map((r) => ({ id: r.id, fullName: r.full_name }));
}

// Texte facultatif nettoyé : null si vide, undefined si invalide
function optionalText(value, max) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return null;
  return text.length <= max ? text : undefined;
}

const isValidDate = (date) => typeof date === 'string' && DATE_RE.test(date) && !Number.isNaN(Date.parse(date));

// Valide le corps de requête. En mode partiel (PATCH), seuls les champs présents sont pris.
async function parseSponsor(body = {}, { partial = false } = {}) {
  const values = {};
  const has = (field) => body[field] !== undefined || !partial;
  const fail = (error) => ({ error });

  if (has('name')) {
    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
    if (!name || name.length > 200) return fail('Nom du partenaire requis (200 caractères max)');
    values.name = name;
  }
  if (has('status')) {
    values.status = body.status ?? 'to_contact';
    if (!STATUSES.includes(values.status)) return fail('Statut invalide');
  }
  if (has('contributionType')) {
    values.contribution_type = body.contributionType ?? 'money';
    if (!CONTRIBUTION_TYPES.includes(values.contribution_type)) return fail("Type d'apport invalide");
  }
  if (has('amount')) {
    if (body.amount === null || body.amount === '' || body.amount === undefined) {
      values.amount = null;
    } else {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount < 0 || amount > 10000000) return fail('Montant invalide');
      values.amount = Math.round(amount * 100) / 100;
    }
  }

  const texts = [
    ['contributionDetails', 'contribution_details', 1000, "Détail de l'apport trop long (1000 caractères max)"],
    ['contactName', 'contact_name', 200, 'Nom du contact trop long'],
    ['contactRole', 'contact_role', 200, 'Fonction du contact trop longue (200 caractères max)'],
    ['contactPhone', 'contact_phone', 50, 'Téléphone trop long'],
    ['notes', 'notes', 5000, 'Notes trop longues (5000 caractères max)'],
  ];
  for (const [field, column, max, message] of texts) {
    if (!has(field)) continue;
    const text = optionalText(body[field] ?? null, max);
    if (text === undefined) return fail(message);
    values[column] = text;
  }

  if (has('contactEmail')) {
    const email = optionalText(body.contactEmail ?? null, 255);
    if (email === undefined || (email && !EMAIL_RE.test(email))) return fail('Email du contact invalide');
    values.contact_email = email && email.toLowerCase();
  }
  if (has('website')) {
    const website = optionalText(body.website ?? null, 500);
    if (website === undefined || (website && !URL_RE.test(website))) {
      return fail('Site web invalide (doit commencer par https://)');
    }
    values.website = website;
  }
  if (has('nextActionDate')) {
    const date = body.nextActionDate || null;
    if (date !== null && !isValidDate(date)) return fail('Date de relance invalide');
    values.next_action_date = date;
  }
  // Responsable : un membre de l'équipe (ownerId) ou, à défaut, un nom saisi à la main (ownerName)
  if (has('ownerId') || has('ownerName')) {
    const ownerName = optionalText(body.ownerName ?? null, 200);
    if (ownerName === undefined) return fail('Nom du responsable trop long (200 caractères max)');
    if (ownerName) {
      values.owner_id = null;
      values.owner_external = ownerName;
    } else {
      const ownerId = body.ownerId === null || body.ownerId === '' || body.ownerId === undefined ? null : Number(body.ownerId);
      if (ownerId !== null) {
        const team = await sponsoringTeam();
        if (!team.some((m) => m.id === ownerId)) return fail("Le responsable doit faire partie de l'équipe Sponsoring");
      }
      values.owner_id = ownerId;
      values.owner_external = null;
    }
  }
  if (has('tierId')) {
    const tierId = body.tierId === null || body.tierId === '' || body.tierId === undefined ? null : Number(body.tierId);
    if (tierId !== null) {
      if (!Number.isInteger(tierId) || tierId <= 0) return fail('Rang introuvable');
      const { rowCount } = await query('SELECT 1 FROM sponsor_tiers WHERE id = $1', [tierId]);
      if (rowCount === 0) return fail('Rang introuvable');
    }
    values.tier_id = tierId;
  }

  // Contreparties : liste complète souhaitée (absente = inchangée)
  let counterparts;
  if (body.counterparts !== undefined) {
    const parsed = parseCounterparts(body.counterparts);
    if (parsed.error) return fail(parsed.error);
    counterparts = parsed.items;
  }

  return { values, counterparts };
}

const MAX_COUNTERPARTS = 100;

function parseCounterparts(list) {
  if (!Array.isArray(list)) return { error: 'Contreparties invalides' };
  if (list.length > MAX_COUNTERPARTS) return { error: `${MAX_COUNTERPARTS} contreparties maximum par partenaire` };
  const items = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') return { error: 'Contrepartie invalide' };
    const label = typeof raw.label === 'string' ? raw.label.trim().replace(/\s+/g, ' ') : '';
    if (!label) return { error: 'Chaque contrepartie doit avoir un intitulé' };
    if (label.length > 300) return { error: 'Intitulé de contrepartie trop long (300 caractères max)' };
    const details = optionalText(raw.details ?? null, 1000);
    if (details === undefined) return { error: 'Précisions de contrepartie trop longues (1000 caractères max)' };
    const dueDate = raw.dueDate || null;
    if (dueDate !== null && !isValidDate(dueDate)) return { error: `Date invalide pour « ${label} »` };
    const id = Number.isInteger(raw.id) && raw.id > 0 ? raw.id : null;
    items.push({ id, label, details, dueDate, done: raw.done === true });
  }
  return { items };
}

async function inTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Remplace les contreparties d'un partenaire par la liste reçue :
// identifiants connus mis à jour, nouvelles lignes insérées, lignes absentes supprimées
async function saveCounterparts(client, sponsorId, items, userId) {
  const { rows } = await client.query('SELECT id FROM sponsor_counterparts WHERE sponsor_id = $1', [sponsorId]);
  const existing = new Set(rows.map((r) => r.id));
  const kept = items.filter((c) => c.id && existing.has(c.id)).map((c) => c.id);
  await client.query('DELETE FROM sponsor_counterparts WHERE sponsor_id = $1 AND NOT (id = ANY($2::int[]))', [
    sponsorId,
    kept,
  ]);
  for (const [position, c] of items.entries()) {
    if (c.id && existing.has(c.id)) {
      // La date de réalisation est conservée tant que la case reste cochée
      await client.query(
        `UPDATE sponsor_counterparts
            SET label = $3, details = $4, due_date = $5, position = $6,
                done_at = CASE WHEN $7::boolean THEN COALESCE(done_at, NOW()) ELSE NULL END,
                updated_at = NOW()
          WHERE id = $1 AND sponsor_id = $2`,
        [c.id, sponsorId, c.label, c.details, c.dueDate, position, c.done]
      );
    } else {
      await client.query(
        `INSERT INTO sponsor_counterparts (sponsor_id, label, details, due_date, position, done_at, created_by)
         VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::boolean THEN NOW() END, $7)`,
        [sponsorId, c.label, c.details, c.dueDate, position, c.done, userId]
      );
    }
  }
}

const NAME_TAKEN = { error: 'Un partenaire porte déjà ce nom' };

async function sendSponsor(res, id, status = 200) {
  const { rows } = await query(`${SELECT_SPONSORS} WHERE s.id = $1`, [id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Partenaire introuvable' });
  const counterparts = await counterpartsBySponsor([id]);
  res.status(status).json({ sponsor: formatSponsor(rows[0], counterparts.get(id)) });
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET /api/sponsoring/sponsors — tous les partenaires (avec leurs contreparties)
router.get('/sponsors', async (req, res) => {
  const { rows } = await query(`${SELECT_SPONSORS} ORDER BY LOWER(s.name)`);
  const counterparts = await counterpartsBySponsor(rows.map((r) => r.id));
  res.json({ sponsors: rows.map((r) => formatSponsor(r, counterparts.get(r.id))) });
});

// GET /api/sponsoring/team — membres pouvant être responsables
router.get('/team', async (req, res) => {
  res.json({ team: await sponsoringTeam() });
});

// POST /api/sponsoring/sponsors — nouveau partenaire (+ contreparties éventuelles)
router.post('/sponsors', async (req, res) => {
  const { values, counterparts, error } = await parseSponsor(req.body);
  if (error) return res.status(400).json({ error });
  if (values.status === 'signed' && !values.tier_id) return res.status(400).json(TIER_REQUIRED);

  values.created_by = req.user.id;
  const columns = Object.keys(values);
  try {
    const id = await inTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO sponsors (${columns.join(', ')})
         VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})
         RETURNING id`,
        columns.map((c) => values[c])
      );
      if (counterparts) await saveCounterparts(client, rows[0].id, counterparts, req.user.id);
      return rows[0].id;
    });
    await sendSponsor(res, id, 201);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json(NAME_TAKEN);
    throw err;
  }
});

// PATCH /api/sponsoring/sponsors/:id — modification (champs présents uniquement)
router.patch('/sponsors/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
  const { values, counterparts, error } = await parseSponsor(req.body, { partial: true });
  if (error) return res.status(400).json({ error });

  const columns = Object.keys(values); // colonnes issues de la liste blanche de parseSponsor
  if (columns.length === 0 && !counterparts) return res.status(400).json({ error: 'Rien à modifier' });

  // État final : un partenaire signé doit avoir un rang
  const { rows: current } = await query('SELECT status, tier_id FROM sponsors WHERE id = $1', [id]);
  if (current.length === 0) return res.status(404).json({ error: 'Partenaire introuvable' });
  const finalStatus = values.status ?? current[0].status;
  const finalTier = 'tier_id' in values ? values.tier_id : current[0].tier_id;
  if (finalStatus === 'signed' && !finalTier) return res.status(400).json(TIER_REQUIRED);

  try {
    const found = await inTransaction(async (client) => {
      const { rowCount } = await client.query(
        `UPDATE sponsors SET ${columns.map((c, i) => `${c} = $${i + 2}, `).join('')}updated_at = NOW()
          WHERE id = $1`,
        [id, ...columns.map((c) => values[c])]
      );
      if (rowCount > 0 && counterparts) await saveCounterparts(client, id, counterparts, req.user.id);
      return rowCount > 0;
    });
    if (!found) return res.status(404).json({ error: 'Partenaire introuvable' });
    await sendSponsor(res, id);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json(NAME_TAKEN);
    throw err;
  }
});

/* ---------- Rangs (Bronze, Argent, Or, Platine + créés par l'équipe) ---------- */

function parseTier(body = {}, { partial = false } = {}) {
  const values = {};
  if (body.name !== undefined || !partial) {
    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
    if (!name || name.length > 40) return { error: 'Nom du rang requis (40 caractères max)' };
    values.name = name;
  }
  if (body.color !== undefined || !partial) {
    const color = body.color ?? '#99aab5';
    if (typeof color !== 'string' || !COLOR_RE.test(color)) return { error: 'Couleur invalide (format #rrggbb)' };
    values.color = color.toLowerCase();
  }
  return { values };
}
const TIER_TAKEN = { error: 'Un rang porte déjà ce nom' };

// GET /api/sponsoring/tiers — avec le nombre de partenaires de chaque rang
router.get('/tiers', async (req, res) => {
  const { rows } = await query(
    `SELECT t.*, COUNT(s.id)::int AS sponsor_count
       FROM sponsor_tiers t LEFT JOIN sponsors s ON s.tier_id = t.id
      GROUP BY t.id ORDER BY t.position, LOWER(t.name)`
  );
  res.json({ tiers: rows.map((r) => ({ ...formatTier(r), sponsorCount: r.sponsor_count })) });
});

// POST /api/sponsoring/tiers { name, color } — nouveau rang, placé après les existants
router.post('/tiers', async (req, res) => {
  const { values, error } = parseTier(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const { rows } = await query(
      `INSERT INTO sponsor_tiers (name, color, position)
       VALUES ($1, $2, (SELECT COALESCE(MAX(position), 0) + 1 FROM sponsor_tiers))
       RETURNING *`,
      [values.name, values.color]
    );
    res.status(201).json({ tier: { ...formatTier(rows[0]), sponsorCount: 0 } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json(TIER_TAKEN);
    throw err;
  }
});

// PATCH /api/sponsoring/tiers/:id { name?, color? }
router.patch('/tiers/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
  const { values, error } = parseTier(req.body, { partial: true });
  if (error) return res.status(400).json({ error });
  const columns = Object.keys(values); // name, color
  if (columns.length === 0) return res.status(400).json({ error: 'Rien à modifier' });
  try {
    const { rows } = await query(
      `UPDATE sponsor_tiers SET ${columns.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...columns.map((c) => values[c])]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Rang introuvable' });
    res.json({ tier: formatTier(rows[0]) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json(TIER_TAKEN);
    throw err;
  }
});

// DELETE /api/sponsoring/tiers/:id — uniquement s'il n'est attribué à aucun partenaire
router.delete('/tiers/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM sponsors WHERE tier_id = $1', [id]);
  if (rows[0].n > 0) {
    return res.status(409).json({ error: `Ce rang est attribué à ${rows[0].n} partenaire(s) : change leur rang d'abord` });
  }
  const { rowCount } = await query('DELETE FROM sponsor_tiers WHERE id = $1', [id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Rang introuvable' });
  res.status(204).end();
});

// DELETE /api/sponsoring/sponsors/:id
router.delete('/sponsors/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
  const { rowCount } = await query('DELETE FROM sponsors WHERE id = $1', [id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Partenaire introuvable' });
  res.status(204).end();
});

module.exports = router;
