// ERP Sponsoring : suivi des partenaires (bureau + membres tagués « Sponsoring »)
const express = require('express');
const { query } = require('../db');
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

function formatSponsor(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    contributionType: row.contribution_type,
    amount: row.amount === null ? null : Number(row.amount),
    contributionDetails: row.contribution_details || '',
    contactName: row.contact_name || '',
    contactEmail: row.contact_email || '',
    contactPhone: row.contact_phone || '',
    website: row.website || '',
    owner: row.owner_id ? { id: row.owner_id, fullName: row.owner_name } : null,
    tier: row.tier_id
      ? { id: row.tier_id, name: row.tier_name, color: row.tier_color, position: row.tier_position }
      : null,
    nextActionDate: row.next_action_date,
    notes: row.notes || '',
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
    if (date !== null && (typeof date !== 'string' || !DATE_RE.test(date) || Number.isNaN(Date.parse(date)))) {
      return fail('Date de relance invalide');
    }
    values.next_action_date = date;
  }
  if (has('ownerId')) {
    const ownerId = body.ownerId === null || body.ownerId === '' || body.ownerId === undefined ? null : Number(body.ownerId);
    if (ownerId !== null) {
      const team = await sponsoringTeam();
      if (!team.some((m) => m.id === ownerId)) return fail("Le responsable doit faire partie de l'équipe Sponsoring");
    }
    values.owner_id = ownerId;
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

  return { values };
}

const NAME_TAKEN = { error: 'Un partenaire porte déjà ce nom' };

async function sendSponsor(res, id, status = 200) {
  const { rows } = await query(`${SELECT_SPONSORS} WHERE s.id = $1`, [id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Partenaire introuvable' });
  res.status(status).json({ sponsor: formatSponsor(rows[0]) });
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET /api/sponsoring/sponsors — tous les partenaires
router.get('/sponsors', async (req, res) => {
  const { rows } = await query(`${SELECT_SPONSORS} ORDER BY LOWER(s.name)`);
  res.json({ sponsors: rows.map(formatSponsor) });
});

// GET /api/sponsoring/team — membres pouvant être responsables
router.get('/team', async (req, res) => {
  res.json({ team: await sponsoringTeam() });
});

// POST /api/sponsoring/sponsors — nouveau partenaire
router.post('/sponsors', async (req, res) => {
  const { values, error } = await parseSponsor(req.body);
  if (error) return res.status(400).json({ error });
  if (values.status === 'signed' && !values.tier_id) return res.status(400).json(TIER_REQUIRED);

  values.created_by = req.user.id;
  const columns = Object.keys(values);
  try {
    const { rows } = await query(
      `INSERT INTO sponsors (${columns.join(', ')})
       VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})
       RETURNING id`,
      columns.map((c) => values[c])
    );
    await sendSponsor(res, rows[0].id, 201);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json(NAME_TAKEN);
    throw err;
  }
});

// PATCH /api/sponsoring/sponsors/:id — modification (champs présents uniquement)
router.patch('/sponsors/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
  const { values, error } = await parseSponsor(req.body, { partial: true });
  if (error) return res.status(400).json({ error });

  const columns = Object.keys(values); // colonnes issues de la liste blanche de parseSponsor
  if (columns.length === 0) return res.status(400).json({ error: 'Rien à modifier' });

  // État final : un partenaire signé doit avoir un rang
  const { rows: current } = await query('SELECT status, tier_id FROM sponsors WHERE id = $1', [id]);
  if (current.length === 0) return res.status(404).json({ error: 'Partenaire introuvable' });
  const finalStatus = values.status ?? current[0].status;
  const finalTier = 'tier_id' in values ? values.tier_id : current[0].tier_id;
  if (finalStatus === 'signed' && !finalTier) return res.status(400).json(TIER_REQUIRED);

  try {
    const { rowCount } = await query(
      `UPDATE sponsors SET ${columns.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = NOW()
        WHERE id = $1`,
      [id, ...columns.map((c) => values[c])]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Partenaire introuvable' });
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
