// Miniatures de la galerie : sm (grille) et lg (visionneuse), en WebP, générées par le worker à partir de l'original du Drive.
// Rotation EXIF appliquée, aucune métadonnée conservée (ni GPS, ni appareil, ni date).
// HEIC/HEIF (iPhone) : les binaires précompilés de sharp ne décodent pas le HEVC → conversion JPEG par heic-convert, puis sharp.
const fs = require('fs/promises');
const path = require('path');
const config = require('./config');

const HEIF_TYPES = new Set(['image/heic', 'image/heif']);
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

let sharpLib = null;
function sharp() {
  if (!sharpLib) {
    sharpLib = require('sharp');
    sharpLib.cache(false); // pas de cache d'images en mémoire : le worker traite chaque photo une seule fois
    sharpLib.concurrency(2);
  }
  return sharpLib;
}

function thumbPath(driveFileId, size, dir = config.THUMBS_DIR) {
  if (!SAFE_ID.test(driveFileId) || !config.THUMB_SIZES[size]) throw new Error('miniature inconnue');
  return path.join(dir, `${driveFileId}_${size}.webp`);
}

// Écrit les deux miniatures ; renvoie les dimensions de la photo une fois redressée
async function renderThumbs(input, driveFileId, dir = config.THUMBS_DIR) {
  const meta = await sharp()(input, { failOn: 'none' }).metadata();
  const base = sharp()(input, { failOn: 'none' }).rotate(); // redresse selon l'orientation EXIF, puis l'oublie
  await fs.mkdir(dir, { recursive: true });
  for (const [size, { width, quality }] of Object.entries(config.THUMB_SIZES)) {
    const target = thumbPath(driveFileId, size, dir);
    const tmp = `${target}.${process.pid}.tmp`;
    await base.clone().resize({ width, withoutEnlargement: true }).webp({ quality }).toFile(tmp); // sans withMetadata : rien n'est copié
    await fs.rename(tmp, target); // jamais de miniature à moitié écrite servie
  }
  const turned = (meta.orientation || 1) >= 5; // orientations 5 à 8 : largeur et hauteur échangées
  return { width: turned ? meta.height : meta.width, height: turned ? meta.width : meta.height };
}

async function heicToJpeg(input) {
  const convert = require('heic-convert');
  return Buffer.from(await convert({ buffer: input, format: 'JPEG', quality: 0.92 }));
}

// Original → miniatures, avec repli HEIC
async function generateThumbs(input, { driveFileId, mimeType }, dir = config.THUMBS_DIR) {
  try {
    return await renderThumbs(input, driveFileId, dir);
  } catch (err) {
    if (!HEIF_TYPES.has(mimeType)) throw err;
    return renderThumbs(await heicToJpeg(input), driveFileId, dir);
  }
}

async function processPhoto({ pool, drive, log }, photo) {
  try {
    if (photo.size_bytes && Number(photo.size_bytes) > config.MAX_ORIGINAL_BYTES) throw new Error('fichier trop volumineux pour une miniature');
    const response = await drive.download(photo.drive_file_id);
    const input = Buffer.from(await response.arrayBuffer());
    const { width, height } = await generateThumbs(input, { driveFileId: photo.drive_file_id, mimeType: photo.mime_type });
    // Le contenu a pu changer pendant le calcul : on ne valide que si l'empreinte est toujours la même
    await pool.query(
      `UPDATE gallery_photos
          SET thumb_status = 'ok', thumb_error = NULL, thumb_attempts = 0, thumbs_generated_for_md5 = md5_checksum,
              width = COALESCE($2, width), height = COALESCE($3, height), updated_at = NOW()
        WHERE id = $1 AND md5_checksum IS NOT DISTINCT FROM $4`,
      [photo.id, width || null, height || null, photo.md5_checksum]
    );
    return true;
  } catch (err) {
    log.warn(`🖼️  Galerie : miniature impossible pour ${photo.filename} (${err.message})`);
    await pool.query(
      `UPDATE gallery_photos SET thumb_status = 'error', thumb_error = $2, thumb_attempts = thumb_attempts + 1, updated_at = NOW()
        WHERE id = $1`,
      [photo.id, String(err.message || err).slice(0, 1000)]
    );
    return false;
  }
}

/**
 * Traite un lot de photos sans miniature (ou dont le contenu a changé), THUMB_CONCURRENCY à la fois.
 * Les erreurs sont retentées plus tard (15 min entre deux essais, 3 essais au plus).
 * Renvoie { processed, ok }.
 */
async function processPendingThumbs({ pool, drive, limit = 20, log = console }) {
  const { rows } = await pool.query(
    `SELECT id, drive_file_id, filename, mime_type, size_bytes, md5_checksum
       FROM gallery_photos
      WHERE NOT is_deleted
        AND (thumb_status = 'pending'
             OR (thumb_status = 'error' AND thumb_attempts < $1 AND updated_at < NOW() - INTERVAL '15 minutes'))
      ORDER BY taken_at DESC
      LIMIT $2`,
    [config.THUMB_MAX_ATTEMPTS, limit]
  );
  let ok = 0;
  let next = 0;
  const workers = Array.from({ length: Math.min(config.THUMB_CONCURRENCY, rows.length) }, async () => {
    while (next < rows.length) {
      const photo = rows[next];
      next += 1;
      if (await processPhoto({ pool, drive, log }, photo)) ok += 1;
    }
  });
  await Promise.all(workers);
  return { processed: rows.length, ok };
}

module.exports = { thumbPath, generateThumbs, processPendingThumbs };
