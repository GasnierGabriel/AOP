// Miniatures : tailles, rotation EXIF, aucune métadonnée (GPS) ; HEIC si un fichier d'exemple est fourni (TEST_HEIC_FILE)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

let sharp = null;
try {
  sharp = require('sharp');
} catch {
  // sharp absent (installation sans dépendances natives) : tests ignorés
}
const { generateThumbs, thumbPath } = require('../src/gallery/thumbnails');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-thumbgen-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// Photo « paysage » de 2400 × 1600 enregistrée de travers (orientation EXIF 6 = à tourner de 90°), avec GPS et appareil
async function sidewaysJpegWithGps() {
  return sharp({ create: { width: 2400, height: 1600, channels: 3, background: { r: 200, g: 30, b: 40 } } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'Apple', Model: 'iPhone 15' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '48/1 51/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '2/1 21/1 0/1' },
    })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

test('miniatures sm et lg redressées, sans aucune métadonnée', { skip: !sharp && 'sharp non installé' }, async () => {
  const input = await sidewaysJpegWithGps();
  const before = await sharp(input).metadata();
  assert.equal(before.orientation, 6);
  assert.ok(before.exif, 'la photo de test contient bien des métadonnées EXIF');

  const dims = await generateThumbs(input, { driveFileId: 'portrait1', mimeType: 'image/jpeg' }, dir);
  assert.deepEqual(dims, { width: 1600, height: 2400 }); // photo redressée : portrait

  for (const [size, width] of [['sm', 400], ['lg', 1600]]) {
    const meta = await sharp(fs.readFileSync(thumbPath('portrait1', size, dir))).metadata();
    assert.equal(meta.format, 'webp', size);
    assert.equal(meta.width, width, size);
    assert.equal(meta.height, Math.round((width * 2400) / 1600), size); // portrait : plus haute que large
    assert.equal(meta.exif, undefined, `${size} : aucune donnée EXIF (donc pas de GPS)`);
    assert.equal(meta.xmp, undefined, size);
    assert.equal(meta.icc, undefined, size);
    assert.ok(!meta.orientation || meta.orientation === 1, size);
  }
});

test('petite image : jamais agrandie', { skip: !sharp && 'sharp non installé' }, async () => {
  const input = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#000f2e' } }).png().toBuffer();
  await generateThumbs(input, { driveFileId: 'petite', mimeType: 'image/png' }, dir);
  const meta = await sharp(fs.readFileSync(thumbPath('petite', 'lg', dir))).metadata();
  assert.equal(meta.width, 300);
});

const heicFile = process.env.TEST_HEIC_FILE;
test('photo HEIC (iPhone) : miniatures générées', { skip: (!sharp || !heicFile) && 'TEST_HEIC_FILE non défini' }, async () => {
  const dims = await generateThumbs(fs.readFileSync(heicFile), { driveFileId: 'heic1', mimeType: 'image/heic' }, dir);
  assert.ok(dims.width > 0 && dims.height > 0);
  const meta = await sharp(fs.readFileSync(thumbPath('heic1', 'sm', dir))).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.exif, undefined);
});

test('identifiant de fichier dangereux refusé (pas de sortie du dossier des miniatures)', () => {
  assert.throws(() => thumbPath('../../etc/passwd', 'sm', dir));
  assert.throws(() => thumbPath('abc', 'xl', dir));
});
