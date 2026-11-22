// Synchro Drive → base, avec un Drive simulé en mémoire et une vraie base PostgreSQL de test.
// Lancée seulement si TEST_DATABASE_URL désigne une base dont le nom finit par « _test » (elle est vidée !) :
//   TEST_DATABASE_URL=postgresql://arece:…@postgres:5432/arece_gallery_test npm test
const test = require('node:test');
const assert = require('node:assert/strict');

const TEST_DB = process.env.TEST_DATABASE_URL || '';
const usable = /\/[\w-]+_test(\?|$)/.test(TEST_DB);
if (usable) process.env.DATABASE_URL = TEST_DB; // avant tout require('../src/db')
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_gallery_sync';
const skip = usable ? false : 'TEST_DATABASE_URL (base *_test) non défini';

const DRIVE = 'DRIVE_TEST';
const FOLDER = 'application/vnd.google-apps.folder';

// Drive partagé simulé : arbre de fichiers + journal des changements, comme l'API (corbeille héritée par le contenu)
function fakeDrive() {
  const files = new Map();
  let seq = 0;
  const log = [];
  const touch = (id) => log.push({ seq: (seq += 1), id });
  const isTrashed = (f) => {
    for (let cur = f, depth = 0; cur && depth < 50; depth += 1) {
      if (cur.trashed) return true;
      cur = files.get(cur.parents?.[0]);
    }
    return false;
  };
  const view = (f) => ({ ...f, trashed: isTrashed(f) });
  const { DriveError } = require('../src/gallery/driveClient');
  return {
    folder(id, parent = DRIVE, name = `Album ${id}`) {
      files.set(id, { id, name, mimeType: FOLDER, parents: [parent] });
      touch(id);
    },
    photo(id, parent, extra = {}) {
      files.set(id, {
        id,
        name: `${id}.jpg`,
        mimeType: 'image/jpeg',
        parents: [parent],
        size: '1000',
        md5Checksum: `md5-${id}`,
        createdTime: '2024-05-01T10:00:00.000Z',
        modifiedTime: '2024-05-01T10:00:00.000Z',
        imageMediaMetadata: { width: 800, height: 600, time: extra.time || '2024:05:01 12:00:00' },
        ...extra,
      });
      touch(id);
    },
    update(id, changes) {
      Object.assign(files.get(id), changes);
      touch(id);
    },
    erase(id) {
      files.delete(id);
      touch(id);
    },
    async listFiles({ parentId, pageToken } = {}) {
      const all = [...files.values()].filter((f) => !isTrashed(f) && (!parentId || f.parents[0] === parentId)).map(view);
      const start = Number(pageToken || 0);
      const page = all.slice(start, start + 3); // petites pages : la pagination est testée
      return { files: page, nextPageToken: start + 3 < all.length ? String(start + 3) : undefined };
    },
    async getStartPageToken() {
      return String(seq);
    },
    async listChanges(token) {
      const since = Number(token);
      if (Number.isNaN(since) || since > seq) throw new DriveError('Drive 400 : jeton invalide', 400);
      const ids = [...new Set(log.filter((l) => l.seq > since).map((l) => l.id))];
      return {
        changes: ids.map((id) =>
          files.has(id) ? { changeType: 'file', fileId: id, removed: false, file: view(files.get(id)) } : { changeType: 'file', fileId: id, removed: true }
        ),
        newStartPageToken: String(seq),
      };
    },
    async getFile(id) {
      if (!files.has(id)) throw new DriveError('Drive 404 : introuvable', 404);
      return view(files.get(id));
    },
  };
}

test.describe('synchro de la galerie', { skip }, () => {
  let pool;
  let runSync;
  let drive;
  const silent = { log() {}, warn() {}, error() {} };
  const sync = (mode = 'auto') => runSync({ pool, drive, driveId: DRIVE, mode, log: silent });
  const album = async (driveFolderId) => (await pool.query('SELECT * FROM gallery_albums WHERE drive_folder_id = $1', [driveFolderId])).rows[0];
  const photo = async (driveFileId) =>
    (
      await pool.query(
        'SELECT p.*, a.drive_folder_id AS album_drive_id FROM gallery_photos p LEFT JOIN gallery_albums a ON a.id = p.album_id WHERE p.drive_file_id = $1',
        [driveFileId]
      )
    ).rows[0];

  test.before(async () => {
    ({ pool } = require('../src/db'));
    const { runMigrations } = require('../src/migrations/init');
    ({ runSync } = require('../src/gallery/syncService'));
    await runMigrations();
    await pool.query('TRUNCATE gallery_photos, gallery_albums RESTART IDENTITY CASCADE');
    await pool.query("UPDATE gallery_sync_state SET start_page_token = NULL, stats = '{}'::jsonb, last_error = NULL WHERE id = 1");
    drive = fakeDrive();
    // 2024 / FSUK (sous-album), 2024 / Atelier, photos à la racine, une vidéo, un PDF
    drive.folder('y2024', DRIVE, '2024');
    drive.folder('fsuk', 'y2024', 'FSUK');
    drive.folder('atelier', DRIVE, 'Atelier');
    for (let i = 1; i <= 4; i += 1) drive.photo(`fsuk${i}`, 'fsuk', { time: `2024:07:1${i} 10:00:00` });
    drive.photo('y1', 'y2024', { time: '2024:03:01 09:00:00' });
    drive.photo('at1', 'atelier', { time: '2023:11:05 18:00:00' });
    drive.photo('root1', DRIVE);
    drive.photo('video1', 'atelier', { mimeType: 'video/mp4' });
    drive.photo('pdf1', 'atelier', { mimeType: 'application/pdf' });
  });
  test.after(async () => pool?.end());

  test('synchro complète : albums, sous-albums, « Non classé », fichiers ignorés', async () => {
    const stats = await sync();
    assert.equal(stats.mode, 'full');
    assert.equal(stats.ignored.video, 1);
    assert.equal(stats.ignored.other, 1);
    assert.equal(stats.errors, 0);
    const y2024 = await album('y2024');
    const fsuk = await album('fsuk');
    assert.equal(fsuk.parent_id, y2024.id);
    assert.equal(y2024.parent_id, null);
    assert.equal(y2024.photo_count, 1);
    assert.equal(y2024.total_photo_count, 5); // sous-album compris
    assert.equal(fsuk.photo_count, 4);
    assert.equal(new Date(y2024.last_taken_at).toISOString(), '2024-07-14T08:00:00.000Z');
    assert.equal(fsuk.auto_cover_photo_id, (await photo('fsuk1')).id); // première photo par date
    const unsorted = await album(DRIVE);
    assert.equal(unsorted.name, 'Non classé');
    assert.equal((await photo('root1')).album_id, unsorted.id);
    assert.equal(await photo('video1'), undefined);
    const state = (await pool.query('SELECT * FROM gallery_sync_state')).rows[0];
    assert.ok(state.start_page_token);
    assert.ok(state.last_full_sync_at);
  });

  test('ajout d’une photo : visible après la synchro incrémentale', async () => {
    drive.photo('fsuk5', 'fsuk', { time: '2024:07:20 10:00:00' });
    const stats = await sync();
    assert.equal(stats.mode, 'incremental');
    assert.equal((await photo('fsuk5')).album_drive_id, 'fsuk');
    assert.equal((await album('fsuk')).photo_count, 5);
    assert.equal((await album('y2024')).total_photo_count, 6);
  });

  test('renommage d’un dossier', async () => {
    drive.update('fsuk', { name: 'Formula Student UK' });
    await sync();
    assert.equal((await album('fsuk')).name, 'Formula Student UK');
  });

  test('déplacement d’une photo entre dossiers', async () => {
    drive.update('fsuk5', { parents: ['atelier'] });
    await sync();
    assert.equal((await photo('fsuk5')).album_drive_id, 'atelier');
    assert.equal((await album('fsuk')).photo_count, 4);
    assert.equal((await album('atelier')).photo_count, 2);
  });

  test('déplacement d’un dossier (sous-album remonté à la racine)', async () => {
    drive.update('fsuk', { parents: [DRIVE] });
    await sync();
    assert.equal((await album('fsuk')).parent_id, null);
    assert.equal((await album('y2024')).total_photo_count, 1);
  });

  test('photo mise à la corbeille, puis supprimée définitivement', async () => {
    drive.update('at1', { trashed: true });
    await sync();
    assert.equal((await photo('at1')).is_deleted, true);
    assert.equal((await album('atelier')).photo_count, 1);
    drive.erase('fsuk5');
    await sync();
    assert.equal((await photo('fsuk5')).is_deleted, true); // la ligne reste (futurs tags), masquée
    assert.equal((await album('atelier')).total_photo_count, 0);
  });

  test('dossier à la corbeille : album, sous-albums et photos masqués ; restauré : tout revient', async () => {
    drive.update('fsuk', { parents: ['y2024'] }); // on remet FSUK sous 2024
    await sync();
    drive.update('y2024', { trashed: true });
    await sync();
    assert.equal((await album('y2024')).is_deleted, true);
    assert.equal((await album('fsuk')).is_deleted, true);
    assert.equal((await photo('fsuk1')).is_deleted, true);
    drive.update('y2024', { trashed: false });
    await sync();
    assert.equal((await album('y2024')).is_deleted, false);
    assert.equal((await album('fsuk')).is_deleted, false);
    assert.equal((await photo('fsuk1')).is_deleted, false);
    assert.equal((await album('y2024')).total_photo_count, 5);
  });

  test('nouveau dossier déjà rempli (déplacé depuis un autre Drive) : contenu lu', async () => {
    drive.folder('nouveau', 'atelier', 'Nouveau');
    drive.photo('n1', 'nouveau');
    drive.photo('n2', 'nouveau');
    await sync();
    assert.equal((await album('nouveau')).photo_count, 2);
    assert.equal((await album('nouveau')).parent_id, (await album('atelier')).id);
  });

  test('photo modifiée (nouvelle empreinte md5) : miniatures à refaire', async () => {
    await pool.query("UPDATE gallery_photos SET thumb_status = 'ok', thumbs_generated_for_md5 = md5_checksum WHERE drive_file_id = 'n1'");
    drive.update('n2', { name: 'renommée.jpg' });
    drive.update('n1', { md5Checksum: 'md5-n1-v2' });
    await sync();
    assert.equal((await photo('n1')).thumb_status, 'pending');
    assert.equal((await photo('n2')).filename, 'renommée.jpg');
  });

  test('jeton de changements refusé : repli sur une synchro complète', async () => {
    await pool.query("UPDATE gallery_sync_state SET start_page_token = 'jeton-perime' WHERE id = 1");
    const stats = await sync();
    assert.equal(stats.mode, 'full');
  });

  test('synchro complète : ce qui a disparu du Drive est masqué', async () => {
    drive.erase('n2');
    drive.erase('root1');
    await sync('full');
    assert.equal((await photo('n2')).is_deleted, true);
    assert.equal((await album(DRIVE)).is_deleted, true); // « Non classé » vide : masqué
  });

  test('une seule synchro à la fois (verrou PostgreSQL)', async () => {
    const holder = await pool.connect();
    try {
      await holder.query("SELECT pg_advisory_lock(hashtext('arece_gallery_sync'))");
      assert.deepEqual(await sync(), { skipped: true });
    } finally {
      await holder.query("SELECT pg_advisory_unlock(hashtext('arece_gallery_sync'))");
      holder.release();
    }
    assert.notEqual((await sync()).skipped, true);
  });
});
