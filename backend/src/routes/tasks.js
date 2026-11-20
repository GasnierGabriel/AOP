// Kanban des tâches de l'asso : tous les membres validés voient, créent, modifient et déplacent les tâches.
// Suppression d'une tâche : son auteur ou le bureau. Pôles : gérés par le bureau.
const express = require('express');
const { query, pool } = require('../db');
const { authenticateToken, requireMember, requireBureau } = require('../auth');
const { notifyTaskAssignedLater } = require('../notifications/taskAssigned');

const router = express.Router();
router.use(authenticateToken, requireMember);

const STATUSES = ['todo', 'doing', 'done'];
const PRIORITIES = ['high', 'medium', 'low'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const MAX_ASSIGNEES = 10;

const isValidDate = (date) => typeof date === 'string' && DATE_RE.test(date) && !Number.isNaN(Date.parse(date));

// Texte facultatif nettoyé : null si vide, undefined si invalide
function optionalText(value, max) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return null;
  return text.length <= max ? text : undefined;
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const SELECT_TASKS = `
  SELECT t.*, p.name AS pole_name, p.color AS pole_color, c.full_name AS created_by_name,
         (SELECT COUNT(*)::int FROM task_comments tc WHERE tc.task_id = t.id) AS comment_count
    FROM tasks t
    LEFT JOIN task_poles p ON p.id = t.pole_id
    LEFT JOIN users c ON c.id = t.created_by`;

async function assigneesByTask(taskIds) {
  const map = new Map(taskIds.map((id) => [id, []]));
  if (taskIds.length === 0) return map;
  const { rows } = await query(
    `SELECT a.task_id, a.user_id, a.name, u.full_name
       FROM task_assignees a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.task_id = ANY($1::int[]) ORDER BY a.position, a.id`,
    [taskIds]
  );
  for (const r of rows) {
    map.get(r.task_id)?.push(r.user_id ? { userId: r.user_id, fullName: r.full_name } : { name: r.name });
  }
  return map;
}

function formatTask(row, assignees, viewer) {
  return {
    id: row.id,
    title: row.title,
    context: row.context || '',
    status: row.status,
    priority: row.priority,
    pole: row.pole_id ? { id: row.pole_id, name: row.pole_name, color: row.pole_color } : null,
    dueDate: row.due_date,
    position: row.position,
    completedAt: row.completed_at,
    assignees,
    commentCount: row.comment_count,
    createdBy: row.created_by ? { id: row.created_by, fullName: row.created_by_name } : null,
    imported: Boolean(row.notion_id), // reprise de l'ancien Kanban Notion
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canDelete: viewer.is_bureau || row.created_by === viewer.id,
  };
}

async function sendTask(res, id, viewer, status = 200) {
  const { rows } = await query(`${SELECT_TASKS} WHERE t.id = $1`, [id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Tâche introuvable' });
  const assignees = await assigneesByTask([id]);
  res.status(status).json({ task: formatTask(rows[0], assignees.get(id), viewer) });
}

// Membres pouvant être responsables d'une tâche : tous les membres validés
async function assignableMembers() {
  const { rows } = await query(
    "SELECT id, full_name FROM users WHERE status <> 'prospect' OR is_bureau ORDER BY LOWER(full_name)"
  );
  return rows.map((r) => ({ id: r.id, fullName: r.full_name }));
}

// Valide le corps de requête. En mode partiel (PATCH), seuls les champs présents sont pris.
async function parseTask(body = {}, { partial = false } = {}) {
  const values = {};
  const has = (field) => body[field] !== undefined || !partial;
  const fail = (error) => ({ error });

  if (has('title')) {
    const title = typeof body.title === 'string' ? body.title.trim().replace(/\s+/g, ' ') : '';
    if (!title || title.length > 300) return fail('Titre de la tâche requis (300 caractères max)');
    values.title = title;
  }
  if (has('context')) {
    const context = optionalText(body.context ?? null, 5000);
    if (context === undefined) return fail('Contexte trop long (5000 caractères max)');
    values.context = context;
  }
  if (has('status')) {
    values.status = body.status ?? 'todo';
    if (!STATUSES.includes(values.status)) return fail('Statut invalide');
  }
  if (has('priority')) {
    values.priority = body.priority ?? 'medium';
    if (!PRIORITIES.includes(values.priority)) return fail('Priorité invalide');
  }
  if (has('poleId')) {
    const poleId = body.poleId === null || body.poleId === '' || body.poleId === undefined ? null : Number(body.poleId);
    if (poleId !== null) {
      if (!Number.isInteger(poleId) || poleId <= 0) return fail('Pôle introuvable');
      const { rowCount } = await query('SELECT 1 FROM task_poles WHERE id = $1', [poleId]);
      if (rowCount === 0) return fail('Pôle introuvable');
    }
    values.pole_id = poleId;
  }
  if (has('dueDate')) {
    const date = body.dueDate || null;
    if (date !== null && !isValidDate(date)) return fail('Échéance invalide');
    values.due_date = date;
  }
  if (body.position !== undefined) {
    const position = Number(body.position);
    if (!Number.isFinite(position)) return fail('Position invalide');
    values.position = position;
  }

  // Responsables : liste complète souhaitée (absente = inchangée)
  let assignees;
  if (body.assignees !== undefined) {
    if (!Array.isArray(body.assignees) || body.assignees.length > MAX_ASSIGNEES) {
      return fail(`Responsables invalides (${MAX_ASSIGNEES} maximum)`);
    }
    const members = new Set((await assignableMembers()).map((m) => m.id));
    assignees = [];
    const seenUsers = new Set();
    const seenNames = new Set();
    for (const raw of body.assignees) {
      if (raw && Number.isInteger(raw.userId)) {
        if (!members.has(raw.userId)) return fail('Responsable introuvable parmi les membres');
        if (!seenUsers.has(raw.userId)) assignees.push({ userId: raw.userId });
        seenUsers.add(raw.userId);
      } else {
        const name = optionalText(raw?.name ?? null, 200);
        if (!name) return fail('Nom de responsable invalide (200 caractères max)');
        if (!seenNames.has(name.toLowerCase())) assignees.push({ name });
        seenNames.add(name.toLowerCase());
      }
    }
  }

  return { values, assignees };
}

// Remplace les responsables ; renvoie les membres nouvellement ajoutés (pour le mail d'assignation)
async function saveAssignees(client, taskId, assignees) {
  const { rows: before } = await client.query('SELECT user_id FROM task_assignees WHERE task_id = $1 AND user_id IS NOT NULL', [taskId]);
  const previous = new Set(before.map((r) => r.user_id));
  await client.query('DELETE FROM task_assignees WHERE task_id = $1', [taskId]);
  for (const [position, a] of assignees.entries()) {
    await client.query('INSERT INTO task_assignees (task_id, user_id, name, position) VALUES ($1, $2, $3, $4)', [
      taskId,
      a.userId ?? null,
      a.userId ? null : a.name,
      position,
    ]);
  }
  return assignees.map((a) => a.userId).filter((id) => id && !previous.has(id));
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

const formatPole = (r) => ({ id: r.id, name: r.name, color: r.color, position: r.position });

// GET /api/tasks — toutes les tâches, les pôles et les membres pouvant être responsables
router.get('/', async (req, res) => {
  const [{ rows }, poles, members] = await Promise.all([
    query(`${SELECT_TASKS} ORDER BY t.position, t.id`),
    query(
      `SELECT p.*, COUNT(t.id)::int AS task_count FROM task_poles p LEFT JOIN tasks t ON t.pole_id = p.id
        GROUP BY p.id ORDER BY p.position, LOWER(p.name)`
    ),
    assignableMembers(),
  ]);
  const assignees = await assigneesByTask(rows.map((r) => r.id));
  res.json({
    tasks: rows.map((r) => formatTask(r, assignees.get(r.id), req.user)),
    poles: poles.rows.map((r) => ({ ...formatPole(r), taskCount: r.task_count })),
    members,
    canManagePoles: req.user.is_bureau,
  });
});

// POST /api/tasks — nouvelle tâche, en haut de sa colonne
router.post('/', async (req, res) => {
  const { values, assignees, error } = await parseTask(req.body);
  if (error) return res.status(400).json({ error });
  if (values.position === undefined) {
    const { rows } = await query('SELECT COALESCE(MIN(position), 0) - 1 AS top FROM tasks WHERE status = $1', [values.status]);
    values.position = rows[0].top;
  }
  if (values.status === 'done') values.completed_at = new Date();
  values.created_by = req.user.id;
  values.updated_by = req.user.id;
  const columns = Object.keys(values);
  let added = [];
  const id = await inTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO tasks (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      columns.map((c) => values[c])
    );
    if (assignees) added = await saveAssignees(client, rows[0].id, assignees);
    return rows[0].id;
  });
  await sendTask(res, id, req.user, 201);
  notifyTaskAssignedLater(id, added, req.user);
});

// PATCH /api/tasks/:id — modification ou déplacement (champs présents uniquement)
router.patch('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
  const { values, assignees, error } = await parseTask(req.body, { partial: true });
  if (error) return res.status(400).json({ error });
  const columns = Object.keys(values); // colonnes issues de la liste blanche de parseTask
  if (columns.length === 0 && !assignees) return res.status(400).json({ error: 'Rien à modifier' });

  let added = [];
  const found = await inTransaction(async (client) => {
    // Date de réalisation : posée en passant à « Fait », retirée en sortant de « Fait »
    const completed = values.status === undefined ? '' : ", completed_at = CASE WHEN $2 = 'done' THEN COALESCE(completed_at, NOW()) ELSE NULL END";
    const params = [id];
    let sets = '';
    if (values.status !== undefined) params.push(values.status); // $2
    for (const c of columns) {
      params.push(values[c]);
      sets += `${c} = $${params.length}, `;
    }
    const { rowCount } = await client.query(
      `UPDATE tasks SET ${sets}updated_by = $${params.length + 1}, updated_at = NOW()${completed} WHERE id = $1`,
      [...params, req.user.id]
    );
    if (rowCount > 0 && assignees) added = await saveAssignees(client, id, assignees);
    return rowCount > 0;
  });
  if (!found) return res.status(404).json({ error: 'Tâche introuvable' });
  await sendTask(res, id, req.user);
  notifyTaskAssignedLater(id, added, req.user);
});

// DELETE /api/tasks/:id — par son auteur ou le bureau
router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
  const { rows } = await query('SELECT created_by FROM tasks WHERE id = $1', [id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Tâche introuvable' });
  if (!req.user.is_bureau && rows[0].created_by !== req.user.id) {
    return res.status(403).json({ error: "Seuls l'auteur de la tâche et le bureau peuvent la supprimer" });
  }
  await query('DELETE FROM tasks WHERE id = $1', [id]);
  res.status(204).end();
});

/* ---------- Commentaires ---------- */

const formatComment = (r, viewer) => ({
  id: r.id,
  author: r.user_id ? { id: r.user_id, fullName: r.full_name } : null,
  authorName: r.author_name || '',
  body: r.body,
  createdAt: r.created_at,
  canDelete: viewer.is_bureau || r.user_id === viewer.id,
});

// GET /api/tasks/:id/comments
router.get('/:id/comments', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
  const { rows } = await query(
    `SELECT c.*, u.full_name FROM task_comments c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.task_id = $1 ORDER BY c.created_at, c.id`,
    [id]
  );
  res.json({ comments: rows.map((r) => formatComment(r, req.user)) });
});

// POST /api/tasks/:id/comments { body }
router.post('/:id/comments', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
  const body = optionalText(req.body?.body ?? null, 5000);
  if (!body) return res.status(400).json({ error: 'Commentaire vide ou trop long (5000 caractères max)' });
  const { rowCount } = await query('SELECT 1 FROM tasks WHERE id = $1', [id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Tâche introuvable' });
  const { rows } = await query(
    'INSERT INTO task_comments (task_id, user_id, body) VALUES ($1, $2, $3) RETURNING *',
    [id, req.user.id, body]
  );
  res.status(201).json({ comment: formatComment({ ...rows[0], full_name: req.user.full_name }, req.user) });
});

// DELETE /api/tasks/comments/:id — par son auteur ou le bureau
router.delete('/comments/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
  const { rows } = await query('SELECT user_id FROM task_comments WHERE id = $1', [id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Commentaire introuvable' });
  if (!req.user.is_bureau && rows[0].user_id !== req.user.id) {
    return res.status(403).json({ error: "Seuls l'auteur du commentaire et le bureau peuvent le supprimer" });
  }
  await query('DELETE FROM task_comments WHERE id = $1', [id]);
  res.status(204).end();
});

/* ---------- Pôles (bureau) ---------- */

function parsePole(body = {}, { partial = false } = {}) {
  const values = {};
  if (body.name !== undefined || !partial) {
    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
    if (!name || name.length > 40) return { error: 'Nom du pôle requis (40 caractères max)' };
    values.name = name;
  }
  if (body.color !== undefined || !partial) {
    const color = body.color ?? '#99aab5';
    if (typeof color !== 'string' || !COLOR_RE.test(color)) return { error: 'Couleur invalide (format #rrggbb)' };
    values.color = color.toLowerCase();
  }
  return { values };
}
const POLE_TAKEN = { error: 'Un pôle porte déjà ce nom' };

router.post('/poles', requireBureau, async (req, res) => {
  const { values, error } = parsePole(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const { rows } = await query(
      `INSERT INTO task_poles (name, color, position)
       VALUES ($1, $2, (SELECT COALESCE(MAX(position), 0) + 1 FROM task_poles)) RETURNING *`,
      [values.name, values.color]
    );
    res.status(201).json({ pole: { ...formatPole(rows[0]), taskCount: 0 } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json(POLE_TAKEN);
    throw err;
  }
});

router.patch('/poles/:id', requireBureau, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
  const { values, error } = parsePole(req.body, { partial: true });
  if (error) return res.status(400).json({ error });
  const columns = Object.keys(values); // name, color
  if (columns.length === 0) return res.status(400).json({ error: 'Rien à modifier' });
  try {
    const { rows } = await query(
      `UPDATE task_poles SET ${columns.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...columns.map((c) => values[c])]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Pôle introuvable' });
    res.json({ pole: formatPole(rows[0]) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json(POLE_TAKEN);
    throw err;
  }
});

// DELETE /api/tasks/poles/:id — uniquement s'il n'est utilisé par aucune tâche
router.delete('/poles/:id', requireBureau, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM tasks WHERE pole_id = $1', [id]);
  if (rows[0].n > 0) {
    return res.status(409).json({ error: `Ce pôle est utilisé par ${rows[0].n} tâche(s) : change leur pôle d'abord` });
  }
  const { rowCount } = await query('DELETE FROM task_poles WHERE id = $1', [id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Pôle introuvable' });
  res.status(204).end();
});

module.exports = router;
