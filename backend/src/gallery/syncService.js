// Synchronisation Drive partagé → base de la galerie.
//  - complète : liste de tout le Drive (premier lancement, jeton de changements absent ou refusé, ou à la demande) ;
//  - incrémentale : changes.list depuis le dernier jeton (créations, renommages, déplacements, corbeille, suppressions).
// Une seule synchro à la fois (verrou PostgreSQL), qu'elle vienne du worker, du bureau ou du script manuel.
// Rien n'est effacé : un fichier disparu du Drive passe en is_deleted = TRUE.
const config = require('./config');
const { DriveError } = require('./driveClient');
const { UNSORTED_ALBUM_NAME, classifyFile, classifyChange } = require('./mapping');

const LOCK_SQL = "hashtext('arece_gallery_sync')";
const MAX_FOLDER_DEPTH = 30;
const MAX_ERROR_SAMPLES = 5;

function newStats(mode) {
  return { mode, startedAt: new Date().toISOString(), folders: 0, photos: 0, removed: 0, changes: 0, ignored: { video: 0, other: 0 }, errors: 0, errorSamples: [] };
}

function recordError(ctx, what, err) {
  ctx.stats.errors += 1;
  if (ctx.stats.errorSamples.length < MAX_ERROR_SAMPLES) ctx.stats.errorSamples.push(`${what} : ${err.message}`);
  ctx.log.warn(`🖼️  Galerie : ${what} ignoré (${err.message})`);
}

/* ---------- Écritures en base ---------- */

async function albumState(db, driveFolderId) {
  const { rows } = await db.query('SELECT id, is_deleted FROM gallery_albums WHERE drive_folder_id = $1', [driveFolderId]);
  return rows[0] || null;
}

async function upsertAlbum(db, { driveFolderId, driveParentId, name }) {
  await db.query(
    `INSERT INTO gallery_albums (drive_folder_id, drive_parent_id, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (drive_folder_id) DO UPDATE
       SET drive_parent_id = EXCLUDED.drive_parent_id, name = EXCLUDED.name, is_deleted = FALSE, updated_at = NOW()
     WHERE (gallery_albums.drive_parent_id, gallery_albums.name, gallery_albums.is_deleted)
           IS DISTINCT FROM (EXCLUDED.drive_parent_id, EXCLUDED.name, FALSE)`,
    [driveFolderId, driveParentId, name]
  );
}

// Album « Non classé » : le Drive partagé lui-même, pour les photos posées à sa racine
const ensureUnsortedAlbum = (db, driveId) => upsertAlbum(db, { driveFolderId: driveId, driveParentId: null, name: UNSORTED_ALBUM_NAME });

async function upsertPhoto(db, p) {
  // Contenu modifié (empreinte md5 différente) : miniatures et dimensions à refaire
  await db.query(
    `INSERT INTO gallery_photos (drive_file_id, drive_parent_id, filename, mime_type, size_bytes, md5_checksum,
                                 width, height, taken_at, drive_created_at, drive_modified_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (drive_file_id) DO UPDATE SET
       drive_parent_id = EXCLUDED.drive_parent_id,
       filename = EXCLUDED.filename,
       mime_type = EXCLUDED.mime_type,
       size_bytes = EXCLUDED.size_bytes,
       md5_checksum = EXCLUDED.md5_checksum,
       width = CASE WHEN gallery_photos.md5_checksum IS DISTINCT FROM EXCLUDED.md5_checksum THEN EXCLUDED.width ELSE COALESCE(gallery_photos.width, EXCLUDED.width) END,
       height = CASE WHEN gallery_photos.md5_checksum IS DISTINCT FROM EXCLUDED.md5_checksum THEN EXCLUDED.height ELSE COALESCE(gallery_photos.height, EXCLUDED.height) END,
       taken_at = EXCLUDED.taken_at,
       drive_created_at = EXCLUDED.drive_created_at,
       drive_modified_at = EXCLUDED.drive_modified_at,
       thumb_status = CASE WHEN gallery_photos.md5_checksum IS DISTINCT FROM EXCLUDED.md5_checksum THEN 'pending' ELSE gallery_photos.thumb_status END,
       thumb_attempts = CASE WHEN gallery_photos.md5_checksum IS DISTINCT FROM EXCLUDED.md5_checksum THEN 0 ELSE gallery_photos.thumb_attempts END,
       is_deleted = FALSE,
       updated_at = NOW()
     WHERE (gallery_photos.drive_parent_id, gallery_photos.filename, gallery_photos.mime_type, gallery_photos.size_bytes,
            gallery_photos.md5_checksum, gallery_photos.taken_at, gallery_photos.drive_modified_at, gallery_photos.is_deleted)
           IS DISTINCT FROM (EXCLUDED.drive_parent_id, EXCLUDED.filename, EXCLUDED.mime_type, EXCLUDED.size_bytes,
            EXCLUDED.md5_checksum, EXCLUDED.taken_at, EXCLUDED.drive_modified_at, FALSE)`,
    [p.driveFileId, p.driveParentId, p.filename, p.mimeType, p.sizeBytes, p.md5Checksum, p.width, p.height, p.takenAt, p.driveCreatedAt, p.driveModifiedAt]
  );
}

// Album et tout ce qu'il contient (sous-albums, photos) masqués
async function deleteAlbumTree(db, driveFolderId) {
  const { rowCount } = await db.query(
    `WITH RECURSIVE tree AS (
       SELECT id FROM gallery_albums WHERE drive_folder_id = $1
       UNION
       SELECT a.id FROM gallery_albums a JOIN tree t ON a.parent_id = t.id
     ), albums AS (
       UPDATE gallery_albums SET is_deleted = TRUE, updated_at = NOW() WHERE id IN (SELECT id FROM tree) AND NOT is_deleted
     )
     UPDATE gallery_photos SET is_deleted = TRUE, updated_at = NOW() WHERE album_id IN (SELECT id FROM tree) AND NOT is_deleted`,
    [driveFolderId]
  );
  return rowCount;
}

async function deletePhoto(db, driveFileId) {
  const { rowCount } = await db.query(
    'UPDATE gallery_photos SET is_deleted = TRUE, updated_at = NOW() WHERE drive_file_id = $1 AND NOT is_deleted',
    [driveFileId]
  );
  return rowCount;
}

// Parent de chaque album et album de chaque photo, d'après les identifiants Drive
async function resolveLinks(db) {
  await db.query(
    `UPDATE gallery_albums a SET parent_id = p.id, updated_at = NOW()
       FROM gallery_albums p
      WHERE p.drive_folder_id = a.drive_parent_id AND p.id <> a.id AND a.parent_id IS DISTINCT FROM p.id`
  );
  await db.query(
    `UPDATE gallery_albums a SET parent_id = NULL, updated_at = NOW()
      WHERE a.parent_id IS NOT NULL
        AND (a.drive_parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM gallery_albums p WHERE p.drive_folder_id = a.drive_parent_id))`
  );
  await db.query(
    `UPDATE gallery_photos ph SET album_id = a.id, updated_at = NOW()
       FROM gallery_albums a
      WHERE a.drive_folder_id = ph.drive_parent_id AND ph.album_id IS DISTINCT FROM a.id`
  );
}

// Nombre de photos, période et couverture de chaque album (sous-albums compris pour le total et la période).
// Couverture automatique : de préférence une photo de l'album lui-même, déjà miniaturisée, la plus ancienne.
async function recomputeAlbums(db) {
  // Couverture choisie à la main dont la photo a été déplacée hors de l'album (et de ses sous-albums) : oubliée.
  // Une photo seulement supprimée reste choisie (elle revient si on la restaure ; la couverture automatique la remplace entre-temps).
  await db.query(
    `WITH RECURSIVE tree AS (
       SELECT id AS ancestor, id AS descendant FROM gallery_albums
       UNION
       SELECT t.ancestor, a.id FROM tree t JOIN gallery_albums a ON a.parent_id = t.descendant
     )
     UPDATE gallery_albums a SET cover_photo_id = NULL, updated_at = NOW()
       FROM gallery_photos p
      WHERE p.id = a.cover_photo_id
        AND NOT EXISTS (SELECT 1 FROM tree t WHERE t.ancestor = a.id AND t.descendant = p.album_id)`
  );
  await db.query(
    `WITH RECURSIVE live AS (
       SELECT id, parent_id FROM gallery_albums WHERE NOT is_deleted
     ), tree AS (
       SELECT id AS ancestor, id AS descendant FROM live
       UNION
       SELECT t.ancestor, l.id FROM tree t JOIN live l ON l.parent_id = t.descendant
     ), direct AS (
       SELECT album_id, COUNT(*)::int AS n FROM gallery_photos WHERE NOT is_deleted AND album_id IS NOT NULL GROUP BY album_id
     ), agg AS (
       SELECT t.ancestor AS id, COUNT(p.id)::int AS total, MIN(p.taken_at) AS first_at, MAX(p.taken_at) AS last_at
         FROM tree t LEFT JOIN gallery_photos p ON p.album_id = t.descendant AND NOT p.is_deleted
        GROUP BY t.ancestor
     ), cover AS (
       SELECT DISTINCT ON (t.ancestor) t.ancestor AS id, p.id AS photo_id
         FROM tree t JOIN gallery_photos p ON p.album_id = t.descendant AND NOT p.is_deleted
        ORDER BY t.ancestor, (p.album_id = t.ancestor) DESC, (p.thumb_status = 'ok') DESC, p.taken_at, p.id
     ), computed AS (
       SELECT agg.id, COALESCE(direct.n, 0) AS n, agg.total, agg.first_at, agg.last_at, cover.photo_id
         FROM agg LEFT JOIN direct ON direct.album_id = agg.id LEFT JOIN cover ON cover.id = agg.id
     )
     UPDATE gallery_albums a
        SET photo_count = c.n, total_photo_count = c.total, first_taken_at = c.first_at, last_taken_at = c.last_at,
            auto_cover_photo_id = c.photo_id, updated_at = NOW()
       FROM computed c
      WHERE a.id = c.id
        AND (a.photo_count, a.total_photo_count, a.first_taken_at, a.last_taken_at, a.auto_cover_photo_id)
            IS DISTINCT FROM (c.n, c.total, c.first_at, c.last_at, c.photo_id)`
  );
}

/* ---------- Application des fichiers du Drive ---------- */

function countIgnored(ctx, reason) {
  if (reason === 'video') ctx.stats.ignored.video += 1;
  else if (reason !== 'drive') ctx.stats.ignored.other += 1;
}

// Dossier dont on ne connaît pas encore les parents (ajouté ou déplacé depuis l'extérieur) : on remonte la chaîne
async function ensureFolderKnown(ctx, folderId, depth = 0) {
  if (!folderId || folderId === ctx.driveId || depth > MAX_FOLDER_DEPTH) return true;
  const existing = await albumState(ctx.db, folderId);
  if (existing && !existing.is_deleted) return true;
  let file;
  try {
    file = await ctx.drive.getFile(folderId);
  } catch (err) {
    if (err instanceof DriveError && err.status === 404) return false; // hors du Drive partagé
    throw err;
  }
  const item = classifyFile(file, ctx.driveId);
  if (item.kind !== 'folder' || item.trashed) return false;
  await applyFolder(ctx, item.album, { rescan: true, depth: depth + 1 });
  return true;
}

// Dossier présent dans le Drive. Nouveau ou restauré de la corbeille : on relit son contenu, que le Drive
// ne signale pas toujours fichier par fichier.
async function applyFolder(ctx, album, { rescan, depth = 0 }) {
  if (album.driveParentId) await ensureFolderKnown(ctx, album.driveParentId, depth + 1);
  const before = rescan ? await albumState(ctx.db, album.driveFolderId) : null;
  await upsertAlbum(ctx.db, album);
  ctx.stats.folders += 1;
  if (rescan && (!before || before.is_deleted) && depth <= MAX_FOLDER_DEPTH) await scanFolder(ctx, album.driveFolderId, depth + 1);
}

async function applyPhoto(ctx, photo, { checkParent }) {
  if (photo.driveParentId === ctx.driveId) await ensureUnsortedAlbum(ctx.db, ctx.driveId);
  else if (checkParent && !(await ensureFolderKnown(ctx, photo.driveParentId))) return;
  await upsertPhoto(ctx.db, photo);
  ctx.stats.photos += 1;
}

async function scanFolder(ctx, folderId, depth) {
  let pageToken;
  do {
    const page = await ctx.drive.listFiles({ parentId: folderId, pageToken });
    const items = (page.files || []).map((f) => [f, classifyFile(f, ctx.driveId)]);
    for (const [file, item] of items) {
      try {
        if (item.kind === 'folder' && !item.trashed) await applyFolder(ctx, item.album, { rescan: true, depth });
        else if (item.kind === 'photo' && !item.trashed) await applyPhoto(ctx, item.photo, { checkParent: false });
        else if (item.kind === 'ignored') countIgnored(ctx, item.reason);
      } catch (err) {
        recordError(ctx, file.name || file.id, err);
      }
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
}

async function applyRemoval(ctx, driveId) {
  const album = await albumState(ctx.db, driveId);
  ctx.stats.removed += album ? await deleteAlbumTree(ctx.db, driveId) : await deletePhoto(ctx.db, driveId);
}

/* ---------- Synchros ---------- */

async function fullSync(ctx) {
  const token = await ctx.drive.getStartPageToken(); // avant la liste : rien de ce qui change pendant la synchro n'est perdu
  const folders = [];
  const photos = [];
  let pageToken;
  do {
    const page = await ctx.drive.listFiles({ pageToken });
    for (const file of page.files || []) {
      const item = classifyFile(file, ctx.driveId);
      if (item.trashed) continue;
      if (item.kind === 'folder') folders.push(item.album);
      else if (item.kind === 'photo') photos.push(item.photo);
      else countIgnored(ctx, item.reason);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  for (const album of folders) {
    try {
      await upsertAlbum(ctx.db, album);
      ctx.stats.folders += 1;
    } catch (err) {
      recordError(ctx, album.name, err);
    }
  }
  if (photos.some((p) => p.driveParentId === ctx.driveId)) await ensureUnsortedAlbum(ctx.db, ctx.driveId);
  for (const photo of photos) {
    try {
      await upsertPhoto(ctx.db, photo);
      ctx.stats.photos += 1;
    } catch (err) {
      recordError(ctx, photo.filename, err);
    }
  }
  await resolveLinks(ctx.db);

  // Ce qui n'est plus dans le Drive est masqué
  const seenAlbums = folders.map((a) => a.driveFolderId);
  if (photos.some((p) => p.driveParentId === ctx.driveId)) seenAlbums.push(ctx.driveId);
  const albums = await ctx.db.query(
    'UPDATE gallery_albums SET is_deleted = TRUE, updated_at = NOW() WHERE NOT is_deleted AND NOT (drive_folder_id = ANY($1::text[]))',
    [seenAlbums]
  );
  const removedPhotos = await ctx.db.query(
    'UPDATE gallery_photos SET is_deleted = TRUE, updated_at = NOW() WHERE NOT is_deleted AND NOT (drive_file_id = ANY($1::text[]))',
    [photos.map((p) => p.driveFileId)]
  );
  ctx.stats.removed += albums.rowCount + removedPhotos.rowCount;

  await ctx.db.query(
    'UPDATE gallery_sync_state SET start_page_token = $1, last_full_sync_at = NOW(), updated_at = NOW() WHERE id = 1',
    [token]
  );
}

async function incrementalSync(ctx, startToken) {
  let pageToken = startToken;
  while (pageToken) {
    const page = await ctx.drive.listChanges(pageToken);
    const items = (page.changes || []).map((change) => ({ change, item: classifyChange(change, ctx.driveId) }));
    ctx.stats.changes += items.length;

    // Un fichier n'apparaît qu'une fois par page (son dernier état) : dossiers d'abord, puis photos, puis disparitions
    const rank = ({ item }) => (item.kind === 'folder' && !item.trashed ? 0 : item.kind === 'photo' && !item.trashed ? 1 : 2);
    items.sort((a, b) => rank(a) - rank(b));
    for (const { change, item } of items) {
      try {
        if (item.kind === 'removed') await applyRemoval(ctx, item.fileId);
        else if (item.kind === 'folder' && item.trashed) ctx.stats.removed += await deleteAlbumTree(ctx.db, item.album.driveFolderId);
        else if (item.kind === 'photo' && item.trashed) ctx.stats.removed += await deletePhoto(ctx.db, item.photo.driveFileId);
        else if (item.kind === 'folder') await applyFolder(ctx, item.album, { rescan: true });
        else if (item.kind === 'photo') await applyPhoto(ctx, item.photo, { checkParent: true });
        else countIgnored(ctx, item.reason);
      } catch (err) {
        if (err instanceof DriveError && err.status !== 404) throw err; // Drive indisponible : on reprendra au même jeton
        recordError(ctx, change.file?.name || change.fileId, err);
      }
      if (item.kind === 'folder') await resolveLinks(ctx.db); // les dossiers suivants peuvent s'y rattacher
    }
    await resolveLinks(ctx.db);

    // Jeton enregistré page par page : une synchro interrompue reprend où elle s'était arrêtée
    const next = page.newStartPageToken || page.nextPageToken;
    await ctx.db.query('UPDATE gallery_sync_state SET start_page_token = $1, updated_at = NOW() WHERE id = 1', [next]);
    pageToken = page.newStartPageToken ? null : page.nextPageToken;
  }
  await ctx.db.query('UPDATE gallery_sync_state SET last_incremental_sync_at = NOW(), updated_at = NOW() WHERE id = 1');
}

/**
 * Lance une synchro. mode : 'auto' (incrémentale, ou complète s'il n'y a pas encore de jeton), 'full' ou 'incremental'.
 * Renvoie { skipped: true } si une autre synchro est déjà en cours.
 */
async function runSync({ pool, drive, driveId = config.DRIVE_ID, mode = 'auto', log = console } = {}) {
  const db = await pool.connect();
  try {
    const { rows } = await db.query(`SELECT pg_try_advisory_lock(${LOCK_SQL}) AS ok`);
    if (!rows[0].ok) return { skipped: true };
    const started = Date.now();
    const ctx = { db, drive, driveId, log, stats: null };
    try {
      await db.query('UPDATE gallery_sync_state SET running_since = NOW(), sync_requested_at = NULL WHERE id = 1');
      const { rows: stateRows } = await db.query('SELECT start_page_token FROM gallery_sync_state WHERE id = 1');
      const token = stateRows[0]?.start_page_token;

      let effective = mode === 'full' || !token ? 'full' : 'incremental';
      ctx.stats = newStats(effective);
      if (effective === 'incremental') {
        try {
          await incrementalSync(ctx, token);
        } catch (err) {
          // Jeton de changements refusé (trop ancien, autre Drive…) : on repart d'une synchro complète
          if (!(err instanceof DriveError) || ![400, 404, 410].includes(err.status)) throw err;
          log.warn(`🖼️  Galerie : jeton de changements refusé (${err.message}), synchro complète`);
          effective = 'full';
          ctx.stats = newStats('full');
        }
      }
      if (effective === 'full') await fullSync(ctx);
      await recomputeAlbums(db);

      ctx.stats.durationMs = Date.now() - started;
      await db.query('UPDATE gallery_sync_state SET stats = $1, updated_at = NOW() WHERE id = 1', [JSON.stringify(ctx.stats)]);
      return ctx.stats;
    } catch (err) {
      const stats = { ...(ctx.stats || newStats(mode)), durationMs: Date.now() - started, failed: true };
      await db
        .query('UPDATE gallery_sync_state SET last_error = $1, last_error_at = NOW(), stats = $2, updated_at = NOW() WHERE id = 1', [
          String(err.message || err).slice(0, 2000),
          JSON.stringify(stats),
        ])
        .catch(() => {});
      throw err;
    } finally {
      await db.query('UPDATE gallery_sync_state SET running_since = NULL WHERE id = 1').catch(() => {});
      await db.query(`SELECT pg_advisory_unlock(${LOCK_SQL})`).catch(() => {});
    }
  } finally {
    db.release();
  }
}

module.exports = { runSync, recomputeAlbums, resolveLinks };
