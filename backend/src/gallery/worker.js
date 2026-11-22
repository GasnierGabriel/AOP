// Service gallery-worker : synchronise la galerie avec le Drive partagé et génère les miniatures, à côté de l'API
// (même image Docker, autre commande : `npm run gallery:worker`). Il ne sert aucune requête HTTP.
//  - au démarrage puis toutes les GALLERY_SYNC_INTERVAL_MINUTES : synchro incrémentale (complète la première fois) ;
//  - à la demande du bureau : NOTIFY gallery_sync (immédiat), ou gallery_sync_state.sync_requested_at (vérifié chaque minute) ;
//  - en continu : miniatures manquantes, 2 à la fois.
require('dotenv').config();
const { pool } = require('../db');
const { runMigrations } = require('../migrations/init');
const config = require('./config');
const { getDriveClient } = require('./driveClient');
const { runSync, recomputeAlbums } = require('./syncService');
const { processPendingThumbs } = require('./thumbnails');

const log = console;
const drive = getDriveClient();

let syncRunning = false;
let syncPending = null; // mode demandé pendant une synchro en cours
async function syncNow(mode = 'auto') {
  if (syncRunning) {
    syncPending = syncPending === 'full' ? 'full' : mode;
    return;
  }
  syncRunning = true;
  try {
    const stats = await runSync({ pool, drive, mode, log });
    if (stats.skipped) log.log('🖼️  Galerie : synchro déjà en cours ailleurs (script manuel ?)');
    else if (stats.mode === 'full' || stats.changes || stats.errors) {
      log.log(
        `🖼️  Galerie : synchro ${stats.mode === 'full' ? 'complète' : 'incrémentale'} en ${Math.round(stats.durationMs / 1000)} s — ` +
          `${stats.folders} dossier(s), ${stats.photos} photo(s), ${stats.removed} retirée(s), ` +
          `${stats.ignored.video} vidéo(s) et ${stats.ignored.other} autre(s) fichier(s) ignorés, ${stats.errors} erreur(s)`
      );
    }
    drainThumbs();
  } catch (err) {
    log.error(`🖼️  Galerie : synchro échouée (${err.message})`);
  } finally {
    syncRunning = false;
    if (syncPending) {
      const next = syncPending;
      syncPending = null;
      setImmediate(() => syncNow(next));
    }
  }
}

let thumbsRunning = false;
async function drainThumbs() {
  if (thumbsRunning) return;
  thumbsRunning = true;
  try {
    for (;;) {
      const { processed, ok } = await processPendingThumbs({ pool, drive, log });
      if (ok > 0) await recomputeAlbums(pool); // couvertures : de préférence des photos déjà miniaturisées
      if (processed === 0) break;
    }
  } catch (err) {
    log.error(`🖼️  Galerie : miniatures interrompues (${err.message})`);
  } finally {
    thumbsRunning = false;
  }
}

// Demande du bureau enregistrée en base (si la notification immédiate a été manquée)
async function checkRequested() {
  try {
    const { rows } = await pool.query('SELECT sync_requested_at FROM gallery_sync_state WHERE id = 1');
    if (rows[0]?.sync_requested_at) syncNow('auto');
  } catch (err) {
    log.error(`🖼️  Galerie : état de synchro illisible (${err.message})`);
  }
}

// Écoute des demandes immédiates ; reconnexion automatique si la base redémarre
async function listen() {
  try {
    const client = await pool.connect();
    client.on('notification', (msg) => syncNow(msg.payload === 'full' ? 'full' : 'auto'));
    client.on('error', () => {
      client.release(true);
      setTimeout(listen, 10000).unref();
    });
    await client.query('LISTEN gallery_sync');
  } catch (err) {
    log.error(`🖼️  Galerie : écoute des demandes impossible (${err.message}), nouvel essai dans 10 s`);
    setTimeout(listen, 10000).unref();
  }
}

async function waitForDatabase(retries = 15, delayMs = 2000) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function main() {
  await waitForDatabase();
  await runMigrations();
  if (!config.isEnabled()) {
    log.log('🖼️  Galerie : désactivée (GALLERY_SHARED_DRIVE_ID vide), le service attend sans rien faire');
    setInterval(() => {}, 1 << 30); // reste allumé : pas de redémarrages en boucle
    return;
  }
  await pool.query('UPDATE gallery_sync_state SET running_since = NULL WHERE id = 1'); // arrêt brutal précédent
  log.log(`🖼️  Galerie : synchro du Drive partagé toutes les ${config.SYNC_INTERVAL_MINUTES} min, miniatures dans ${config.THUMBS_DIR}`);
  await listen();
  syncNow('auto');
  setInterval(() => syncNow('auto'), config.SYNC_INTERVAL_MINUTES * 60 * 1000);
  setInterval(checkRequested, 60 * 1000);
  setInterval(drainThumbs, 60 * 1000); // erreurs à retenter, photos ajoutées par le script manuel
}

process.on('SIGTERM', () => process.exit(0));
main().catch((err) => {
  log.error('❌ gallery-worker : démarrage impossible', err);
  process.exit(1);
});
