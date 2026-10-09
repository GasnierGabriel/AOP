// Wiki de l'asso : tous les membres validés lisent, créent et modifient ; chaque version est conservée.
const express = require('express');
const { query, pool } = require('../db');
const { authenticateToken, requireMember, requireBureau } = require('../auth');

const router = express.Router();
router.use(authenticateToken, requireMember);

const MAX_TITLE = 200;
const MAX_CONTENT = 100000;

function slugify(text) {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'page';
}

// Slug libre : « titre », puis « titre-2 », « titre-3 »…
async function uniqueSlug(db, table, base) {
  let slug = base;
  for (let n = 2; (await db.query(`SELECT 1 FROM ${table} WHERE slug = $1`, [slug])).rowCount > 0; n += 1) {
    slug = `${base.slice(0, 75)}-${n}`;
  }
  return slug;
}

// Aperçu texte d'une page (Markdown grossièrement retiré)
function excerpt(content, length = 180) {
  const text = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;
}

const escapeLike = (term) => term.replace(/[\\%_]/g, '\\$&');

const formatCategory = (r) => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  emoji: r.emoji,
  description: r.description || '',
  pageCount: r.page_count === undefined ? undefined : Number(r.page_count),
});

const PAGE_SELECT = `
  SELECT p.*, c.name AS category_name, c.slug AS category_slug, c.emoji AS category_emoji,
         cu.full_name AS created_by_name, uu.full_name AS updated_by_name
    FROM wiki_pages p
    JOIN wiki_categories c ON c.id = p.category_id
    LEFT JOIN users cu ON cu.id = p.created_by
    LEFT JOIN users uu ON uu.id = p.updated_by`;

function formatPage(r, { withContent = false } = {}) {
  return {
    id: r.id,
    title: r.title,
    slug: r.slug,
    category: { id: r.category_id, name: r.category_name, slug: r.category_slug, emoji: r.category_emoji },
    createdBy: r.created_by ? { id: r.created_by, fullName: r.created_by_name } : null,
    updatedBy: r.updated_by ? { id: r.updated_by, fullName: r.updated_by_name } : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(withContent ? { content: r.content } : { excerpt: excerpt(r.content) }),
  };
}

async function findPage(slug) {
  const { rows } = await query(`${PAGE_SELECT} WHERE p.slug = $1`, [slug]);
  return rows[0];
}

function parsePageInput(body = {}) {
  const title = typeof body.title === 'string' ? body.title.trim().replace(/\s+/g, ' ') : '';
  if (!title || title.length > MAX_TITLE) return { error: `Titre requis (${MAX_TITLE} caractères max)` };
  const content = typeof body.content === 'string' ? body.content : '';
  if (content.length > MAX_CONTENT) return { error: 'Page trop longue (100 000 caractères max)' };
  const categoryId = Number(body.categoryId);
  if (!Number.isInteger(categoryId) || categoryId <= 0) return { error: 'Catégorie requise' };
  return { values: { title, content, categoryId } };
}

async function categoryExists(db, id) {
  return (await db.query('SELECT 1 FROM wiki_categories WHERE id = $1', [id])).rowCount > 0;
}

/* ---------- Catégories ---------- */

// GET /api/wiki/categories — avec le nombre de pages
router.get('/categories', async (req, res) => {
  const { rows } = await query(
    `SELECT c.*, COUNT(p.id) AS page_count
       FROM wiki_categories c
       LEFT JOIN wiki_pages p ON p.category_id = c.id
      GROUP BY c.id
      ORDER BY c.position, LOWER(c.name)`
  );
  res.json({ categories: rows.map(formatCategory), canManage: req.user.is_bureau });
});

function parseCategoryInput(body = {}, { partial = false } = {}) {
  const values = {};
  if (body.name !== undefined || !partial) {
    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
    if (!name || name.length > 80) return { error: 'Nom de catégorie requis (80 caractères max)' };
    values.name = name;
  }
  if (body.emoji !== undefined) {
    const emoji = typeof body.emoji === 'string' ? body.emoji.trim() : '';
    if ([...emoji].length > 8) return { error: 'Emoji invalide' };
    values.emoji = emoji || null;
  }
  if (body.description !== undefined) {
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (description.length > 300) return { error: 'Description trop longue (300 caractères max)' };
    values.description = description || null;
  }
  return { values };
}

// POST /api/wiki/categories (bureau)
router.post('/categories', requireBureau, async (req, res) => {
  const { values, error } = parseCategoryInput(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const slug = await uniqueSlug(pool, 'wiki_categories', slugify(values.name));
    const { rows } = await query(
      `INSERT INTO wiki_categories (name, slug, emoji, description, position)
       VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(position), 0) + 1 FROM wiki_categories))
       RETURNING *`,
      [values.name, slug, values.emoji ?? null, values.description ?? null]
    );
    res.status(201).json({ category: formatCategory({ ...rows[0], page_count: 0 }) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Une catégorie porte déjà ce nom' });
    throw err;
  }
});

// PATCH /api/wiki/categories/:id (bureau) — le slug reste stable pour ne pas casser les liens
router.patch('/categories/:id', requireBureau, async (req, res) => {
  const id = Number(req.params.id);
  const { values, error } = parseCategoryInput(req.body, { partial: true });
  if (error) return res.status(400).json({ error });
  const columns = Object.keys(values); // liste blanche : name, emoji, description
  if (columns.length === 0) return res.status(400).json({ error: 'Rien à modifier' });
  try {
    const { rows } = await query(
      `UPDATE wiki_categories SET ${columns.map((c, i) => `${c} = $${i + 2}`).join(', ')}
        WHERE id = $1 RETURNING *`,
      [id, ...columns.map((c) => values[c])]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Catégorie introuvable' });
    res.json({ category: formatCategory(rows[0]) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Une catégorie porte déjà ce nom' });
    throw err;
  }
});

// DELETE /api/wiki/categories/:id (bureau) — uniquement si elle ne contient aucune page
router.delete('/categories/:id', requireBureau, async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM wiki_pages WHERE category_id = $1', [id]);
  if (rows[0].n > 0) {
    return res.status(409).json({ error: `Cette catégorie contient ${rows[0].n} page(s) : déplace-les ou supprime-les d'abord` });
  }
  const { rowCount } = await query('DELETE FROM wiki_categories WHERE id = $1', [id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Catégorie introuvable' });
  res.status(204).end();
});

/* ---------- Pages ---------- */

// GET /api/wiki/pages?categorie=slug&q=texte&tri=recent|titre
router.get('/pages', async (req, res) => {
  const category = typeof req.query.categorie === 'string' && req.query.categorie ? req.query.categorie : null;
  const term = typeof req.query.q === 'string' && req.query.q.trim() ? `%${escapeLike(req.query.q.trim())}%` : null;
  const order = req.query.tri === 'titre' ? 'LOWER(p.title)' : 'p.updated_at DESC';
  const { rows } = await query(
    `${PAGE_SELECT}
      WHERE ($1::text IS NULL OR c.slug = $1)
        AND ($2::text IS NULL OR p.title ILIKE $2 OR p.content ILIKE $2)
      ORDER BY ${order}
      LIMIT 300`,
    [category, term]
  );
  res.json({ pages: rows.map((r) => formatPage(r)) });
});

// GET /api/wiki/pages/:slug
router.get('/pages/:slug', async (req, res) => {
  const page = await findPage(req.params.slug);
  if (!page) return res.status(404).json({ error: 'Page introuvable' });
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM wiki_revisions WHERE page_id = $1', [page.id]);
  res.json({
    page: { ...formatPage(page, { withContent: true }), revisionCount: rows[0].n },
    canDelete: req.user.is_bureau || page.created_by === req.user.id,
  });
});

// POST /api/wiki/pages { title, categoryId, content }
router.post('/pages', async (req, res) => {
  const { values, error } = parsePageInput(req.body);
  if (error) return res.status(400).json({ error });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!(await categoryExists(client, values.categoryId))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Catégorie introuvable' });
    }
    const slug = await uniqueSlug(client, 'wiki_pages', slugify(values.title));
    const { rows } = await client.query(
      `INSERT INTO wiki_pages (category_id, title, slug, content, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
      [values.categoryId, values.title, slug, values.content, req.user.id]
    );
    await client.query(
      'INSERT INTO wiki_revisions (page_id, category_id, title, content, edited_by) VALUES ($1, $2, $3, $4, $5)',
      [rows[0].id, values.categoryId, values.title, values.content, req.user.id]
    );
    await client.query('COMMIT');
    res.status(201).json({ page: formatPage(await findPage(slug), { withContent: true }) });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Conflit de nom de page, réessaie' });
    throw err;
  } finally {
    client.release();
  }
});

// PUT /api/wiki/pages/:slug { title, categoryId, content, baseUpdatedAt }
// baseUpdatedAt = date de la version éditée : si la page a changé entre-temps, on refuse (409)
router.put('/pages/:slug', async (req, res) => {
  const { values, error } = parsePageInput(req.body);
  if (error) return res.status(400).json({ error });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT p.*, u.full_name AS updated_by_name FROM wiki_pages p
         LEFT JOIN users u ON u.id = p.updated_by
        WHERE p.slug = $1 FOR UPDATE OF p`,
      [req.params.slug]
    );
    const page = rows[0];
    if (!page) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Page introuvable' });
    }
    if (req.body.baseUpdatedAt && new Date(req.body.baseUpdatedAt).getTime() !== page.updated_at.getTime()) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `${page.updated_by_name || "Quelqu'un"} a modifié cette page pendant que tu l'éditais. Copie ton texte, recharge la page et réintègre tes changements.`,
        code: 'EDIT_CONFLICT',
      });
    }
    if (!(await categoryExists(client, values.categoryId))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Catégorie introuvable' });
    }

    const unchanged =
      page.title === values.title && page.content === values.content && page.category_id === values.categoryId;
    if (!unchanged) {
      await client.query(
        `UPDATE wiki_pages SET title = $2, content = $3, category_id = $4, updated_by = $5, updated_at = NOW()
          WHERE id = $1`,
        [page.id, values.title, values.content, values.categoryId, req.user.id]
      );
      await client.query(
        'INSERT INTO wiki_revisions (page_id, category_id, title, content, edited_by) VALUES ($1, $2, $3, $4, $5)',
        [page.id, values.categoryId, values.title, values.content, req.user.id]
      );
    }
    await client.query('COMMIT');
    res.json({ page: formatPage(await findPage(page.slug), { withContent: true }), unchanged });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// DELETE /api/wiki/pages/:slug — auteur de la page ou bureau
router.delete('/pages/:slug', async (req, res) => {
  const page = await findPage(req.params.slug);
  if (!page) return res.status(404).json({ error: 'Page introuvable' });
  if (!req.user.is_bureau && page.created_by !== req.user.id) {
    return res.status(403).json({ error: "Seul l'auteur de la page ou le bureau peut la supprimer" });
  }
  await query('DELETE FROM wiki_pages WHERE id = $1', [page.id]);
  res.status(204).end();
});

/* ---------- Historique ---------- */

// GET /api/wiki/pages/:slug/revisions
router.get('/pages/:slug/revisions', async (req, res) => {
  const page = await findPage(req.params.slug);
  if (!page) return res.status(404).json({ error: 'Page introuvable' });
  const { rows } = await query(
    `SELECT r.id, r.title, r.created_at, LENGTH(r.content) AS length, u.id AS user_id, u.full_name
       FROM wiki_revisions r LEFT JOIN users u ON u.id = r.edited_by
      WHERE r.page_id = $1 ORDER BY r.created_at DESC, r.id DESC`,
    [page.id]
  );
  res.json({
    revisions: rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.created_at,
      length: r.length,
      editedBy: r.user_id ? { id: r.user_id, fullName: r.full_name } : null,
    })),
  });
});

// GET /api/wiki/pages/:slug/revisions/:id — contenu d'une ancienne version
router.get('/pages/:slug/revisions/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT r.*, u.full_name FROM wiki_revisions r
       JOIN wiki_pages p ON p.id = r.page_id
       LEFT JOIN users u ON u.id = r.edited_by
      WHERE p.slug = $1 AND r.id = $2`,
    [req.params.slug, Number(req.params.id)]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Version introuvable' });
  const r = rows[0];
  res.json({
    revision: {
      id: r.id,
      title: r.title,
      content: r.content,
      categoryId: r.category_id,
      createdAt: r.created_at,
      editedBy: r.edited_by ? { id: r.edited_by, fullName: r.full_name } : null,
    },
  });
});

module.exports = router;
