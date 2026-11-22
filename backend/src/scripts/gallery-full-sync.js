// Synchro complète de la galerie, à la main :
//   docker compose -f docker-compose.prod.yml --env-file .env exec gallery-worker npm run gallery:full-sync
// Relit tout le Drive partagé (utile après une longue coupure ou un doute) ; les miniatures manquantes
// sont ensuite générées par le service gallery-worker.
require('dotenv').config();
const { pool } = require('../db');
const config = require('../gallery/config');
const { getDriveClient } = require('../gallery/driveClient');
const { runSync } = require('../gallery/syncService');

async function main() {
  if (!config.isEnabled()) throw new Error('GALLERY_SHARED_DRIVE_ID est vide : galerie désactivée');
  console.log('Synchro complète du Drive partagé en cours…');
  const stats = await runSync({ pool, drive: getDriveClient(), mode: 'full' });
  if (stats.skipped) {
    console.log('Une synchro est déjà en cours : réessaie dans quelques minutes.');
    process.exitCode = 1;
    return;
  }
  console.log(
    `Terminé en ${Math.round(stats.durationMs / 1000)} s : ${stats.folders} dossier(s), ${stats.photos} photo(s), ` +
      `${stats.removed} élément(s) retiré(s), ${stats.ignored.video} vidéo(s) et ${stats.ignored.other} autre(s) fichier(s) ignorés, ` +
      `${stats.errors} erreur(s).`
  );
  for (const sample of stats.errorSamples) console.log(`  - ${sample}`);
  console.log('Les miniatures manquantes sont générées par le service gallery-worker.');
}

main()
  .catch((err) => {
    console.error(`❌ Synchro impossible : ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
