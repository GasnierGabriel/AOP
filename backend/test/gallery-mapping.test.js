// Traduction des réponses de l'API Drive en albums / photos (sans base ni réseau)
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyFile, classifyChange, parseTakenAt } = require('../src/gallery/mapping');

const DRIVE = 'drive-root-id';
const folder = (id, parent = DRIVE, extra = {}) => ({ id, name: `Dossier ${id}`, mimeType: 'application/vnd.google-apps.folder', parents: [parent], ...extra });
const image = (id, parent, extra = {}) => ({
  id,
  name: `${id}.jpg`,
  mimeType: 'image/jpeg',
  parents: [parent],
  size: '123456',
  md5Checksum: 'abc',
  createdTime: '2024-03-01T10:00:00.000Z',
  modifiedTime: '2024-03-02T10:00:00.000Z',
  imageMediaMetadata: { width: 4000, height: 3000, time: '2024:07:14 15:00:00' },
  ...extra,
});

test('dossier à la racine du Drive : album de premier niveau', () => {
  const item = classifyFile(folder('f1'), DRIVE);
  assert.equal(item.kind, 'folder');
  assert.deepEqual(item.album, { driveFolderId: 'f1', driveParentId: null, name: 'Dossier f1' });
  assert.equal(item.trashed, false);
});

test('sous-dossier : rattaché à son dossier parent', () => {
  const item = classifyFile(folder('f2', 'f1'), DRIVE);
  assert.equal(item.album.driveParentId, 'f1');
});

test('photo : album = dossier parent direct, métadonnées reprises', () => {
  const item = classifyFile(image('p1', 'f2'), DRIVE);
  assert.equal(item.kind, 'photo');
  assert.equal(item.photo.driveParentId, 'f2');
  assert.equal(item.photo.sizeBytes, 123456);
  assert.equal(item.photo.width, 4000);
  assert.equal(item.photo.height, 3000);
  assert.equal(item.photo.md5Checksum, 'abc');
  assert.equal(item.photo.driveModifiedAt.toISOString(), '2024-03-02T10:00:00.000Z');
});

test('photo à la racine du Drive : album « Non classé » (le Drive lui-même)', () => {
  assert.equal(classifyFile(image('p0', DRIVE), DRIVE).photo.driveParentId, DRIVE);
  assert.equal(classifyFile(image('p0', undefined, { parents: undefined }), DRIVE).photo.driveParentId, DRIVE);
});

test('types acceptés : JPEG, PNG, WebP, HEIC, HEIF ; HEIC sans type précis reconnu à son extension', () => {
  for (const mimeType of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']) {
    assert.equal(classifyFile(image('x', 'f1', { mimeType }), DRIVE).kind, 'photo', mimeType);
  }
  const heic = classifyFile(image('x', 'f1', { mimeType: 'application/octet-stream', name: 'IMG_0001.HEIC' }), DRIVE);
  assert.equal(heic.kind, 'photo');
  assert.equal(heic.photo.mimeType, 'image/heic');
});

test('fichiers non-images ignorés : vidéos comptées à part', () => {
  assert.deepEqual(classifyFile(image('v', 'f1', { mimeType: 'video/mp4' }), DRIVE), { kind: 'ignored', reason: 'video' });
  assert.deepEqual(classifyFile(image('d', 'f1', { mimeType: 'application/pdf' }), DRIVE), { kind: 'ignored', reason: 'other' });
  assert.deepEqual(classifyFile(image('g', 'f1', { mimeType: 'image/gif' }), DRIVE), { kind: 'ignored', reason: 'other' });
  assert.deepEqual(classifyFile(image('s', 'f1', { mimeType: 'application/vnd.google-apps.shortcut' }), DRIVE), { kind: 'ignored', reason: 'other' });
});

test('mise à la corbeille signalée', () => {
  assert.equal(classifyFile(image('p1', 'f1', { trashed: true }), DRIVE).trashed, true);
  assert.equal(classifyFile(folder('f1', DRIVE, { trashed: true }), DRIVE).trashed, true);
});

test('date EXIF lue en heure de Paris (été et hiver)', () => {
  assert.equal(parseTakenAt({ imageMediaMetadata: { time: '2024:07:14 15:00:00' } }).toISOString(), '2024-07-14T13:00:00.000Z');
  assert.equal(parseTakenAt({ imageMediaMetadata: { time: '2024:01:10 15:00:00' } }).toISOString(), '2024-01-10T14:00:00.000Z');
});

test("date EXIF absente ou invalide : date d'ajout au Drive", () => {
  const createdTime = '2023-05-01T08:30:00.000Z';
  assert.equal(parseTakenAt({ createdTime }).toISOString(), createdTime);
  assert.equal(parseTakenAt({ createdTime, imageMediaMetadata: { time: '0000:00:00 00:00:00' } }).toISOString(), createdTime);
  assert.equal(parseTakenAt({ createdTime, imageMediaMetadata: { time: '2099:01:01 00:00:00' } }).toISOString(), createdTime);
});

test('changements : suppression définitive, fichier modifié, changement du Drive lui-même', () => {
  assert.deepEqual(classifyChange({ changeType: 'file', fileId: 'p1', removed: true }, DRIVE), { kind: 'removed', fileId: 'p1' });
  assert.equal(classifyChange({ changeType: 'file', fileId: 'p1', removed: false, file: image('p1', 'f1') }, DRIVE).kind, 'photo');
  assert.equal(classifyChange({ changeType: 'drive', driveId: DRIVE }, DRIVE).kind, 'ignored');
});
