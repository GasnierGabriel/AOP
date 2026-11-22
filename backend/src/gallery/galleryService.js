// Lecture de la galerie (albums, photos, état de synchro). Toute la logique est ici et non dans les routes,
// pour être réutilisée telle quelle par un futur outil MCP (galerie_chercher) ou par l'envoi de photos depuis l'ERP.
// viewer = { id, canManage } : les liens d'images sont signés pour ce membre ; liens Drive réservés au bureau.
const { query } = require('../db');
const config = require('./config');
const signing = require('./signing');

const MAX_DEPTH = 30;
const DEFAULT_PAGE = 60;
const MAX_PAGE = 120;

const ALBUM_COLUMNS = `
  a.id, a.drive_folder_id, a.name, a.parent_id, a.photo_count, a.total_photo_count, a.first_taken_at, a.last_taken_at,
  COALESCE(manual.id, auto.id) AS cover_id`;
const ALBUM_JOINS = `
  LEFT JOIN gallery_photos manual ON manual.id = a.cover_photo_id AND NOT manual.is_deleted AND manual.thumb_status = 'ok'
  LEFT JOIN gallery_photos auto ON auto.id = a.auto_cover_photo_id AND NOT auto.is_deleted AND auto.thumb_status = 'ok'`;

function formatAlbum(r, viewer) {
  return {
    id: r.id,
    name: r.name,
    parentId: r.parent_id,
    isUnsorted: r.drive_folder_id === config.DRIVE_ID,
    photoCount: r.photo_count,
    totalPhotoCount: r.total_photo_count,
    firstTakenAt: r.first_taken_at,
    lastTakenAt: r.last_taken_at,
    cover: r.cover_id
      ? { id: r.cover_id, thumbSm: signing.thumbUrl(r.cover_id, 'sm', viewer.id), thumbLg: signing.thumbUrl(r.cover_id, 'lg', viewer.id) }
      : null,
    ...(viewer.canManage && { driveUrl: config.folderUrl(r.drive_folder_id) }),
  };
}

function formatPhoto(r, viewer) {
  const ready = r.thumb_status === 'ok';
  return {
    id: r.id,
    albumId: r.album_id,
    filename: r.filename,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
    width: r.width,
    height: r.height,
    takenAt: r.taken_at,
    thumbStatus: r.thumb_status,
    thumbSm: ready ? signing.thumbUrl(r.id, 'sm', viewer.id) : null,
    thumbLg: ready ? signing.thumbUrl(r.id, 'lg', viewer.id) : null,
    originalUrl: signing.originalUrl(r.id, viewer.id),
    ...(viewer.canManage && { driveUrl: `https://drive.google.com/file/d/${encodeURIComponent(r.drive_file_id)}/view` }),
  };
}

const PHOTO_COLUMNS = 'p.id, p.album_id, p.drive_file_id, p.filename, p.mime_type, p.size_bytes, p.width, p.height, p.taken_at, p.thumb_status';

// Curseur de pagination : (date de prise de vue, id) de la dernière photo renvoyée, opaque pour le client
const encodeCursor = (row) => Buffer.from(JSON.stringify([row.taken_at_raw, row.id])).toString('base64url');
function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const [takenAt, id] = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    // Date au format texte de PostgreSQL (« 2024-05-12 12:03:22.123+00 ») : relue telle quelle, sans perte de précision
    if (typeof takenAt !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)?$/.test(takenAt)) return undefined;
    if (!Number.isInteger(id)) return undefined;
    return { takenAt, id };
  } catch {
    return undefined;
  }
}

// Albums visibles (non supprimés, avec au moins une photo, sous-albums compris), les plus récents d'abord
async function listAlbums(viewer) {
  const { rows } = await query(
    `SELECT ${ALBUM_COLUMNS}
       FROM gallery_albums a ${ALBUM_JOINS}
      WHERE NOT a.is_deleted AND a.total_photo_count > 0
      ORDER BY a.last_taken_at DESC NULLS LAST, LOWER(a.name), a.id`
  );
  return rows.map((r) => formatAlbum(r, viewer));
}

// Album, fil d'Ariane (albums parents) et sous-albums ; null si introuvable ou supprimé
async function getAlbum(albumId, viewer) {
  const { rows } = await query(
    `SELECT ${ALBUM_COLUMNS} FROM gallery_albums a ${ALBUM_JOINS} WHERE a.id = $1 AND NOT a.is_deleted`,
    [albumId]
  );
  if (rows.length === 0) return null;
  const [crumbs, children] = await Promise.all([
    query(
      `WITH RECURSIVE up AS (
         SELECT id, name, parent_id, 0 AS depth FROM gallery_albums WHERE id = $1
         UNION ALL
         SELECT p.id, p.name, p.parent_id, up.depth + 1 FROM gallery_albums p JOIN up ON p.id = up.parent_id
          WHERE up.depth < ${MAX_DEPTH} AND NOT p.is_deleted
       )
       SELECT id, name FROM up WHERE depth > 0 ORDER BY depth DESC`,
      [albumId]
    ),
    query(
      `SELECT ${ALBUM_COLUMNS} FROM gallery_albums a ${ALBUM_JOINS}
        WHERE a.parent_id = $1 AND NOT a.is_deleted AND a.total_photo_count > 0
        ORDER BY a.first_taken_at NULLS LAST, LOWER(a.name), a.id`, -- sous-albums dans l'ordre chronologique (Jour 1, Jour 2…)
      [albumId]
    ),
  ]);
  return {
    album: formatAlbum(rows[0], viewer),
    breadcrumb: crumbs.rows.map((r) => ({ id: r.id, name: r.name })),
    subAlbums: children.rows.map((r) => formatAlbum(r, viewer)),
  };
}

/**
 * Photos d'un album, les plus récentes d'abord, par pages (curseur, sans OFFSET).
 * Renvoie null si l'album n'existe pas, { error } si le curseur est invalide.
 */
async function listPhotos(albumId, { cursor, limit } = {}, viewer) {
  const size = Math.min(Math.max(Number.parseInt(limit, 10) || DEFAULT_PAGE, 1), MAX_PAGE);
  const after = decodeCursor(cursor);
  if (after === undefined) return { error: 'Curseur invalide' };
  const album = await query('SELECT photo_count FROM gallery_albums WHERE id = $1 AND NOT is_deleted', [albumId]);
  if (album.rows.length === 0) return null;

  const params = [albumId, size + 1];
  let where = 'p.album_id = $1 AND NOT p.is_deleted';
  if (after) {
    params.push(after.takenAt, after.id);
    where += ' AND (p.taken_at, p.id) < ($3::timestamptz, $4::int)';
  }
  const { rows } = await query(
    `SELECT ${PHOTO_COLUMNS}, p.taken_at::text AS taken_at_raw
       FROM gallery_photos p
      WHERE ${where}
      ORDER BY p.taken_at DESC, p.id DESC
      LIMIT $2`,
    params
  );
  const page = rows.slice(0, size);
  return {
    photos: page.map((r) => formatPhoto(r, viewer)),
    nextCursor: rows.length > size ? encodeCursor(page[page.length - 1]) : null,
    total: album.rows[0].photo_count,
  };
}

// Une photo, avec sa place dans l'album (« 12 / 148 ») ; null si introuvable
async function getPhoto(photoId, viewer) {
  const { rows } = await query(
    `SELECT ${PHOTO_COLUMNS}
       FROM gallery_photos p JOIN gallery_albums a ON a.id = p.album_id
      WHERE p.id = $1 AND NOT p.is_deleted AND NOT a.is_deleted`,
    [photoId]
  );
  if (rows.length === 0) return null;
  const photo = rows[0];
  const { rows: counts } = await query(
    `SELECT COUNT(*) FILTER (WHERE (g.taken_at, g.id) > (me.taken_at, me.id))::int AS before, COUNT(*)::int AS total
       FROM gallery_photos g, (SELECT taken_at, id FROM gallery_photos WHERE id = $2) me
      WHERE g.album_id = $1 AND NOT g.is_deleted`,
    [photo.album_id, photo.id]
  );
  return { photo: formatPhoto(photo, viewer), position: counts[0].before + 1, total: counts[0].total };
}

// Fichier d'une photo pour les routes d'images (null si supprimée)
async function getPhotoFile(photoId) {
  const { rows } = await query(
    `SELECT p.id, p.drive_file_id, p.filename, p.mime_type, p.size_bytes, p.thumb_status
       FROM gallery_photos p JOIN gallery_albums a ON a.id = p.album_id
      WHERE p.id = $1 AND NOT p.is_deleted AND NOT a.is_deleted`,
    [photoId]
  );
  return rows[0] || null;
}

// Synchro demandée par le bureau : notification immédiate au worker, et trace en base s'il ne l'a pas reçue
async function requestSync(mode = 'auto') {
  await query('UPDATE gallery_sync_state SET sync_requested_at = NOW() WHERE id = 1');
  await query("SELECT pg_notify('gallery_sync', $1)", [mode === 'full' ? 'full' : 'auto']);
}

async function getSyncStatus() {
  const [{ rows: state }, { rows: counts }] = await Promise.all([
    query('SELECT * FROM gallery_sync_state WHERE id = 1'),
    query(
      `SELECT (SELECT COUNT(*)::int FROM gallery_albums WHERE NOT is_deleted AND total_photo_count > 0) AS albums,
              COUNT(*)::int AS photos,
              COUNT(*) FILTER (WHERE thumb_status = 'pending')::int AS thumbs_pending,
              COUNT(*) FILTER (WHERE thumb_status = 'error')::int AS thumbs_error
         FROM gallery_photos WHERE NOT is_deleted`
    ),
  ]);
  const s = state[0] || {};
  const lastSyncAt = [s.last_full_sync_at, s.last_incremental_sync_at].filter(Boolean).sort((a, b) => b - a)[0] || null;
  return {
    configured: config.isEnabled(),
    driveUrl: config.isEnabled() ? config.folderUrl(config.DRIVE_ID) : null,
    intervalMinutes: config.SYNC_INTERVAL_MINUTES,
    lastSyncAt,
    lastFullSyncAt: s.last_full_sync_at || null,
    lastIncrementalSyncAt: s.last_incremental_sync_at || null,
    running: Boolean(s.running_since && Date.now() - new Date(s.running_since).getTime() < 2 * 3600 * 1000),
    requestedAt: s.sync_requested_at || null,
    lastError: s.last_error || null,
    lastErrorAt: s.last_error_at || null,
    stats: s.stats || {},
    counts: {
      albums: counts[0].albums,
      photos: counts[0].photos,
      thumbsPending: counts[0].thumbs_pending,
      thumbsError: counts[0].thumbs_error,
    },
  };
}

// Membre (pour vérifier ses droits à chaque image, sans en-tête d'authentification)
async function getUserForAccess(userId) {
  const { rows } = await query('SELECT id, status, is_bureau, level FROM users WHERE id = $1', [userId]);
  return rows[0] || null;
}

module.exports = {
  listAlbums,
  getAlbum,
  listPhotos,
  getPhoto,
  getPhotoFile,
  requestSync,
  getSyncStatus,
  getUserForAccess,
  decodeCursor,
};
