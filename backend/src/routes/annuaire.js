const express = require('express');
const { query } = require('../db');
const {
  userColumns,
  authenticateToken,
  requireMember,
  requireBureau,
  canViewUser,
  getCurrentAcademicYear,
} = require('../auth');
const {
  cleanPromo,
  PROMO_ERROR,
  formatUser,
  getRolesByUserIds,
  getCompetitionsByUserIds,
  getTagsByUserIds,
  formatTag,
  getFullMember,
} = require('../members');

const router = express.Router();
const MAX_TEXT_LENGTH = 5000;
const MAX_TAG_LENGTH = 40;
const DEFAULT_TAG_COLOR = '#99aab5';
const COLOR_RE = /^#[0-9a-f]{6}$/i;
// Uniquement des caractères emoji (séquences ZWJ, drapeaux, keycaps, teintes de peau compris)
const EMOJI_CHARS_RE = /^[\p{Extended_Pictographic}\p{Emoji_Component}\p{Emoji_Modifier}‍️⃣]+$/u;
const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;

router.use(authenticateToken);

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizeTagName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  return name && name.length <= MAX_TAG_LENGTH ? name : null;
}

// Valide { name, color, emoji }. En mode partiel (PATCH), seuls les champs présents sont pris.
function parseTagInput(body = {}, { partial = false } = {}) {
  const values = {};

  if (body.name !== undefined || !partial) {
    values.name = normalizeTagName(body.name);
    if (!values.name) return { error: `Nom de tag requis (${MAX_TAG_LENGTH} caractères max)` };
  }

  if (body.color !== undefined || !partial) {
    const color = body.color ?? DEFAULT_TAG_COLOR;
    if (typeof color !== 'string' || !COLOR_RE.test(color)) {
      return { error: 'Couleur invalide (format #rrggbb)' };
    }
    values.color = color.toLowerCase();
  }

  if (body.emoji !== undefined || !partial) {
    const emoji = typeof body.emoji === 'string' ? body.emoji.trim() : body.emoji;
    if (emoji === null || emoji === undefined || emoji === '') {
      values.emoji = null;
    } else if (
      typeof emoji !== 'string' ||
      [...emoji].length > 16 ||
      !EMOJI_CHARS_RE.test(emoji) ||
      !EMOJI_RE.test(emoji)
    ) {
      return { error: 'La puce doit être un emoji' };
    } else {
      values.emoji = emoji;
    }
  }

  return { values };
}

const TAG_NAME_TAKEN = { error: 'Un tag porte déjà ce nom' };

// Rôles et compétitions éditables (soi-même ou bureau)
require('./career')(router);

async function userExists(id) {
  const { rowCount } = await query('SELECT 1 FROM users WHERE id = $1', [id]);
  return rowCount > 0;
}

// Le niveau d'accès (1/2) est une donnée interne : seul le bureau le voit
function forViewer(viewer, member) {
  if (viewer.is_bureau) return member;
  const { level, ...visible } = member;
  return visible;
}

const STATUSES = ['active', 'alumni', 'honorary', 'prospect'];

// GET /api/annuaire/members — membres visibles selon les permissions du viewer
router.get('/members', requireMember, async (req, res) => {
  const { rows } = await query(`SELECT ${userColumns()} FROM users ORDER BY full_name`);
  const visible = rows.filter((u) => canViewUser(req.user, u));
  const ids = visible.map((u) => u.id);

  const [roles, competitions, tags] = await Promise.all([
    getRolesByUserIds(ids, { currentOnly: true }),
    getCompetitionsByUserIds(ids),
    getTagsByUserIds(ids),
  ]);

  res.json({
    academicYear: getCurrentAcademicYear().label,
    members: visible.map((u) =>
      forViewer(req.user, {
        ...formatUser(u),
        currentRoles: roles.get(u.id) || [],
        competitions: competitions.get(u.id) || [],
        tags: tags.get(u.id) || [],
      })
    ),
  });
});

// GET /api/annuaire/members/:id — fiche complète
router.get('/members/:id', requireMember, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identifiant invalide' });

  const { rows } = await query(`SELECT ${userColumns()} FROM users WHERE id = $1`, [id]);
  const target = rows[0];
  if (!target) return res.status(404).json({ error: 'Membre introuvable' });
  if (!canViewUser(req.user, target)) {
    return res.status(403).json({ error: "Tu n'as pas accès à ce profil" });
  }

  res.json({
    member: forViewer(req.user, await getFullMember(target)),
    canManageTags: req.user.is_bureau,
    canEditCareer: req.user.is_bureau || req.user.id === target.id,
  });
});

// DELETE /api/annuaire/members/:id — suppression définitive d'un compte (bureau).
// Profil, rôles, compétitions, tags attribués et sessions partent avec (ON DELETE CASCADE).
router.delete('/members/:id', requireBureau, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
  if (id === req.user.id) {
    return res.status(400).json({ error: 'Tu ne peux pas supprimer ton propre compte' });
  }

  const { rows } = await query('SELECT is_bureau FROM users WHERE id = $1', [id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Membre introuvable' });
  // Évite de supprimer un membre du bureau par erreur (et garantit qu'il en reste toujours un)
  if (rows[0].is_bureau) {
    return res.status(409).json({ error: "Retire d'abord ce membre du bureau avant de supprimer son compte" });
  }

  await query('DELETE FROM users WHERE id = $1', [id]);
  res.status(204).end();
});

// PATCH /api/annuaire/members/:id/access { status?, isBureau?, level?, promo? } — gestion des membres (bureau)
router.patch('/members/:id/access', requireBureau, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
  const { status, isBureau, level } = req.body || {};

  if (status !== undefined && !STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Statut invalide' });
  }
  if (isBureau !== undefined && typeof isBureau !== 'boolean') {
    return res.status(400).json({ error: 'Valeur « bureau » invalide' });
  }
  if (level !== undefined && level !== 1 && level !== 2) {
    return res.status(400).json({ error: 'Niveau invalide (1 ou 2)' });
  }
  const promo = req.body?.promo === undefined ? undefined : cleanPromo(req.body.promo);
  if (req.body?.promo !== undefined && promo === undefined) {
    return res.status(400).json({ error: PROMO_ERROR() });
  }
  if (status === undefined && isBureau === undefined && level === undefined && promo === undefined) {
    return res.status(400).json({ error: 'Rien à modifier' });
  }

  const { rows } = await query(`SELECT ${userColumns()} FROM users WHERE id = $1`, [id]);
  const target = rows[0];
  if (!target) return res.status(404).json({ error: 'Membre introuvable' });

  const next = {
    status: status ?? target.status,
    is_bureau: isBureau ?? target.is_bureau,
    level: level ?? target.level,
    promo: promo === undefined ? target.promo : promo,
  };
  if (next.is_bureau && next.status === 'prospect') {
    return res.status(400).json({ error: 'Un membre du bureau ne peut pas être prospect' });
  }

  // Ne jamais retirer le dernier membre du bureau (sinon plus personne ne peut gérer les accès)
  if (target.is_bureau && !next.is_bureau) {
    const { rows: count } = await query('SELECT COUNT(*)::int AS n FROM users WHERE is_bureau');
    if (count[0].n <= 1) {
      return res.status(409).json({ error: 'Il doit rester au moins un membre du bureau' });
    }
  }

  const { rows: updated } = await query(
    `UPDATE users SET status = $2, is_bureau = $3, level = $4, promo = $5, updated_at = NOW()
      WHERE id = $1
      RETURNING ${userColumns()}`,
    [id, next.status, next.is_bureau, next.level, next.promo]
  );
  res.json({ member: formatUser(updated[0]) });
});

// GET /api/annuaire/tags — tous les tags existants avec leur nombre de membres (bureau)
router.get('/tags', requireBureau, async (req, res) => {
  const { rows } = await query(
    `SELECT t.id, t.name, t.color, t.emoji, COUNT(ut.user_id)::int AS member_count
       FROM tags t
       LEFT JOIN user_tags ut ON ut.tag_id = t.id
      GROUP BY t.id
      ORDER BY LOWER(t.name)`
  );
  res.json({ tags: rows.map((r) => ({ ...formatTag(r), memberCount: r.member_count })) });
});

// POST /api/annuaire/tags { name, color, emoji } — crée un tag (bureau)
router.post('/tags', requireBureau, async (req, res) => {
  const { values, error } = parseTagInput(req.body);
  if (error) return res.status(400).json({ error });

  try {
    const { rows } = await query(
      `INSERT INTO tags (name, color, emoji, created_by) VALUES ($1, $2, $3, $4)
       RETURNING id, name, color, emoji`,
      [values.name, values.color, values.emoji, req.user.id]
    );
    res.status(201).json({ tag: formatTag(rows[0]) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json(TAG_NAME_TAKEN);
    throw err;
  }
});

// PATCH /api/annuaire/tags/:id { name?, color?, emoji? } — modifie un tag (bureau)
router.patch('/tags/:id', requireBureau, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
  const { values, error } = parseTagInput(req.body, { partial: true });
  if (error) return res.status(400).json({ error });

  const fields = Object.keys(values); // sous-ensemble de name / color / emoji
  if (fields.length === 0) return res.status(400).json({ error: 'Rien à modifier' });

  try {
    const { rows } = await query(
      `UPDATE tags SET ${fields.map((f, i) => `${f} = $${i + 2}`).join(', ')}
        WHERE id = $1
        RETURNING id, name, color, emoji`,
      [id, ...fields.map((f) => values[f])]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Tag introuvable' });
    res.json({ tag: formatTag(rows[0]) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json(TAG_NAME_TAKEN);
    throw err;
  }
});

// DELETE /api/annuaire/tags/:id — supprime un tag et le retire de tous les membres (bureau)
router.delete('/tags/:id', requireBureau, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
  const { rowCount } = await query('DELETE FROM tags WHERE id = $1', [id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Tag introuvable' });
  res.status(204).end();
});

// POST /api/annuaire/members/:id/tags { tagId } — attribue un tag existant à un membre (bureau)
router.post('/members/:id/tags', requireBureau, async (req, res) => {
  const id = parseId(req.params.id);
  const tagId = parseId(req.body?.tagId);
  if (!id || !tagId) return res.status(400).json({ error: 'Identifiant invalide' });
  if (!(await userExists(id))) return res.status(404).json({ error: 'Membre introuvable' });

  const { rowCount } = await query(
    `INSERT INTO user_tags (user_id, tag_id, added_by)
     SELECT $1, id, $3 FROM tags WHERE id = $2
     ON CONFLICT (user_id, tag_id) DO NOTHING`,
    [id, tagId, req.user.id]
  );
  if (rowCount === 0) {
    const { rowCount: tagExists } = await query('SELECT 1 FROM tags WHERE id = $1', [tagId]);
    if (!tagExists) return res.status(404).json({ error: 'Tag introuvable' });
  }

  const tags = await getTagsByUserIds([id]);
  res.status(201).json({ tags: tags.get(id) || [] });
});

// DELETE /api/annuaire/members/:id/tags/:tagId — retire un tag d'un membre
router.delete('/members/:id/tags/:tagId', requireBureau, async (req, res) => {
  const id = parseId(req.params.id);
  const tagId = parseId(req.params.tagId);
  if (!id || !tagId) return res.status(400).json({ error: 'Identifiant invalide' });

  await query('DELETE FROM user_tags WHERE user_id = $1 AND tag_id = $2', [id, tagId]);
  const tags = await getTagsByUserIds([id]);
  res.json({ tags: tags.get(id) || [] });
});

// PUT /api/annuaire/profile — mise à jour de sa propre bio / ses réalisations / sa promo
router.put('/profile', async (req, res) => {
  const { bio, achievements } = req.body || {};
  const promo = req.body?.promo === undefined ? undefined : cleanPromo(req.body.promo);
  if (req.body?.promo !== undefined && promo === undefined) {
    return res.status(400).json({ error: PROMO_ERROR() });
  }
  for (const [field, value] of Object.entries({ bio, achievements })) {
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') {
      return res.status(400).json({ error: `Le champ ${field} doit être du texte` });
    }
    if (value.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ error: `Le champ ${field} dépasse ${MAX_TEXT_LENGTH} caractères` });
    }
  }

  // Champ absent = inchangé ; chaîne vide = effacé
  const { rows } = await query(
    `INSERT INTO user_profile (user_id, bio, achievements)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       bio = COALESCE($2, user_profile.bio),
       achievements = COALESCE($3, user_profile.achievements),
       updated_at = NOW()
     RETURNING bio, achievements, updated_at`,
    [req.user.id, bio ?? null, achievements ?? null]
  );
  if (promo !== undefined) {
    await query('UPDATE users SET promo = $2, updated_at = NOW() WHERE id = $1', [req.user.id, promo]);
  }

  const profile = rows[0];
  res.json({
    profile: {
      bio: profile.bio || '',
      achievements: profile.achievements || '',
      updatedAt: profile.updated_at,
    },
    promo: promo === undefined ? req.user.promo : promo,
  });
});

module.exports = router;
