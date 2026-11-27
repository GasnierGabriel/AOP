// Permissions de chaque route de la galerie, pour chaque statut et niveau (service et Drive simulés, sans base)
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_gallery_routes';
require('express-async-errors');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { createGalleryRouter, contentDisposition } = require('../src/routes/gallery');
const signing = require('../src/gallery/signing');

const USERS = {
  bureau: { id: 1, status: 'active', is_bureau: true, level: 2 },
  actifL1: { id: 2, status: 'active', is_bureau: false, level: 1 },
  actifL2: { id: 3, status: 'active', is_bureau: false, level: 2 },
  alumniL1: { id: 4, status: 'alumni', is_bureau: false, level: 1 },
  alumniL2: { id: 5, status: 'alumni', is_bureau: false, level: 2 },
  honoraireL1: { id: 6, status: 'honorary', is_bureau: false, level: 1 },
  honoraireL2: { id: 7, status: 'honorary', is_bureau: false, level: 2 },
  prospect: { id: 8, status: 'prospect', is_bureau: false, level: 1 },
};
const VIEWERS = ['bureau', 'actifL1', 'actifL2', 'alumniL1', 'alumniL2', 'honoraireL2'];
const REFUSED = ['honoraireL1', 'prospect'];
const SECRET = 'secret-de-test';

const thumbsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-thumbs-'));
fs.writeFileSync(path.join(thumbsDir, 'drivefile1_sm.webp'), 'RIFFxxxxWEBP');
fs.writeFileSync(path.join(thumbsDir, 'drivefile1_lg.webp'), 'RIFFxxxxWEBP');

let syncRequests = 0;
const service = {
  listAlbums: async () => [],
  getAlbum: async (id) => (id === 1 ? { album: { id: 1 }, breadcrumb: [], subAlbums: [] } : null),
  listPhotos: async (id) => (id === 1 ? { photos: [], nextCursor: null, total: 0 } : null),
  getPhoto: async (id) => (id === 1 ? { photo: { id: 1 }, position: 1, total: 1 } : null),
  getPhotoFile: async (id) =>
    id === 1 ? { id: 1, drive_file_id: 'drivefile1', filename: 'Équipe à Silverstone.jpg', mime_type: 'image/jpeg', thumb_status: 'ok' } : null,
  requestSync: async () => {
    syncRequests += 1;
  },
  getSyncStatus: async () => ({ configured: true }),
  setAlbumCover: async (id, photoId) => {
    if (id !== 1) return null;
    if (photoId === 999) return { error: "Cette photo n'est pas dans l'album" };
    coverCalls.push(photoId);
    return { album: { id: 1 }, breadcrumb: [], subAlbums: [] };
  },
};
const coverCalls = [];
const drive = { download: async () => new Response('JPEG-ORIGINAL', { headers: { 'content-length': '13' } }) };

let baseUrl;
let server;
test.before(async () => {
  const app = express();
  app.use(express.json());
  const authenticate = (req, res, next) => {
    const user = USERS[req.get('x-test-user')];
    if (!user) return res.status(401).json({ error: 'Authentification requise' });
    req.user = user;
    next();
  };
  app.use(
    '/api/gallery',
    createGalleryRouter({
      authenticate,
      service,
      drive,
      loadUser: async (id) => Object.values(USERS).find((u) => u.id === id) || null,
      signingOptions: { secret: SECRET },
      thumbsDir,
      isEnabled: () => true,
    })
  );
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => {
  server.close();
  fs.rmSync(thumbsDir, { recursive: true, force: true });
});

const call = (method, url, who, body) =>
  fetch(`${baseUrl}${url}`, {
    method,
    headers: { ...(who && { 'x-test-user': who }), ...(body !== undefined && { 'content-type': 'application/json' }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

const MEMBER_ROUTES = [
  ['GET', '/gallery/albums', 200],
  ['GET', '/gallery/albums/1', 200],
  ['GET', '/gallery/albums/1/photos?limit=60', 200],
  ['GET', '/gallery/photos/1', 200],
];

for (const [method, url, expected] of MEMBER_ROUTES) {
  test(`${method} ${url} : membres autorisés`, async () => {
    for (const who of VIEWERS) assert.equal((await call(method, url, who)).status, expected, who);
  });
  test(`${method} ${url} : honoraire L1 et prospect refusés, anonyme non connecté`, async () => {
    for (const who of REFUSED) assert.equal((await call(method, url, who)).status, 403, who);
    assert.equal((await call(method, url)).status, 401);
  });
}

test('album ou photo inexistant : 404', async () => {
  assert.equal((await call('GET', '/gallery/albums/999', 'actifL1')).status, 404);
  assert.equal((await call('GET', '/gallery/albums/abc/photos', 'actifL1')).status, 404);
  assert.equal((await call('GET', '/gallery/photos/999', 'actifL1')).status, 404);
});

test('POST /gallery/sync : bureau uniquement', async () => {
  const before = syncRequests;
  assert.equal((await call('POST', '/gallery/sync', 'bureau')).status, 202);
  assert.equal(syncRequests, before + 1);
  for (const who of [...VIEWERS.filter((w) => w !== 'bureau'), ...REFUSED]) {
    assert.equal((await call('POST', '/gallery/sync', who)).status, 403, who);
  }
  assert.equal(syncRequests, before + 1);
  assert.equal((await call('POST', '/gallery/sync')).status, 401);
});

test('PUT /gallery/albums/:id/cover : bureau uniquement', async () => {
  coverCalls.length = 0;
  assert.equal((await call('PUT', '/gallery/albums/1/cover', 'bureau', { photoId: 5 })).status, 200);
  assert.equal((await call('PUT', '/gallery/albums/1/cover', 'bureau', { photoId: null })).status, 200); // couverture automatique
  assert.deepEqual(coverCalls, [5, null]);
  for (const who of [...VIEWERS.filter((w) => w !== 'bureau'), ...REFUSED]) {
    assert.equal((await call('PUT', '/gallery/albums/1/cover', who, { photoId: 5 })).status, 403, who);
  }
  assert.equal((await call('PUT', '/gallery/albums/1/cover', undefined, { photoId: 5 })).status, 401);
  assert.deepEqual(coverCalls, [5, null]);
});

test('PUT /gallery/albums/:id/cover : photo invalide, hors de l’album, album inconnu', async () => {
  assert.equal((await call('PUT', '/gallery/albums/1/cover', 'bureau', { photoId: 'abc' })).status, 400);
  assert.equal((await call('PUT', '/gallery/albums/1/cover', 'bureau', {})).status, 400);
  assert.equal((await call('PUT', '/gallery/albums/1/cover', 'bureau', { photoId: 999 })).status, 400);
  assert.equal((await call('PUT', '/gallery/albums/42/cover', 'bureau', { photoId: 5 })).status, 404);
});

test('GET /gallery/sync/status : bureau uniquement', async () => {
  assert.equal((await call('GET', '/gallery/sync/status', 'bureau')).status, 200);
  for (const who of [...VIEWERS.filter((w) => w !== 'bureau'), ...REFUSED]) {
    assert.equal((await call('GET', '/gallery/sync/status', who)).status, 403, who);
  }
});

const thumbLink = (user, size = 'sm', opts = {}) => signing.thumbUrl(1, size, USERS[user].id, { secret: SECRET, ...opts });
const originalLink = (user, opts = {}) => signing.originalUrl(1, USERS[user].id, { secret: SECRET, ...opts });

test('miniature : lien signé valable pour les membres autorisés, en cache privé', async () => {
  for (const who of VIEWERS) {
    for (const size of ['sm', 'lg']) {
      const res = await call('GET', thumbLink(who, size));
      assert.equal(res.status, 200, `${who} ${size}`);
      assert.equal(res.headers.get('content-type'), 'image/webp');
      assert.equal(res.headers.get('cache-control'), 'private, max-age=86400');
    }
  }
});

test('miniature : refusée aux prospects et honoraires L1, même avec un lien signé à leur nom', async () => {
  for (const who of REFUSED) assert.equal((await call('GET', thumbLink(who))).status, 403, who);
});

test('miniature : refusée sans signature, signature fausse, expirée, autre taille ou autre photo', async () => {
  assert.equal((await call('GET', '/gallery/photos/1/thumb?size=sm', 'actifL1')).status, 403); // la session ne suffit pas
  const good = new URL(thumbLink('actifL1'), 'http://x');
  const tampered = new URL(good);
  tampered.searchParams.set('sig', `${good.searchParams.get('sig').slice(0, -2)}AA`);
  assert.equal((await call('GET', `${tampered.pathname}${tampered.search}`)).status, 403);
  const otherUser = new URL(good);
  otherUser.searchParams.set('u', String(USERS.bureau.id));
  assert.equal((await call('GET', `${otherUser.pathname}${otherUser.search}`)).status, 403);
  assert.equal((await call('GET', thumbLink('actifL1', 'sm', { now: Date.now() - 3 * 3600 * 1000 }))).status, 403);
  assert.equal((await call('GET', thumbLink('actifL1', 'sm').replace('size=sm', 'size=lg'))).status, 403);
  assert.equal((await call('GET', thumbLink('actifL1', 'sm').replace('size=sm', 'size=xl'))).status, 400);
  assert.equal((await call('GET', thumbLink('actifL1').replace('/photos/1/', '/photos/2/'))).status, 403);
});

test('original : téléchargement pour les membres autorisés, refusé aux autres', async () => {
  for (const who of VIEWERS) {
    const res = await call('GET', originalLink(who));
    assert.equal(res.status, 200, who);
    assert.match(res.headers.get('content-disposition'), /^attachment;/);
    assert.equal(await res.text(), 'JPEG-ORIGINAL');
  }
  for (const who of REFUSED) assert.equal((await call('GET', originalLink(who))).status, 403, who);
  assert.equal((await call('GET', '/gallery/photos/1/original', 'bureau')).status, 403);
  // Un lien de miniature ne permet pas de télécharger l'original
  assert.equal((await call('GET', thumbLink('actifL1').replace('/thumb?size=sm&', '/original?'))).status, 403);
});

test('nom de fichier du téléchargement : accents conservés (RFC 6266)', () => {
  assert.equal(
    contentDisposition('Équipe à Silverstone.jpg'),
    `attachment; filename="Equipe a Silverstone.jpg"; filename*=UTF-8''%C3%89quipe%20%C3%A0%20Silverstone.jpg`
  );
});
