// Client Drive : paramètres « Drive partagé » et reprise sur limite de débit / erreurs serveur
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDriveClient, DriveError } = require('../src/gallery/driveClient');

function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(new URL(url));
    const [status, body] = responses.shift();
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
}
const client = (fetchImpl, extra = {}) =>
  createDriveClient({ apiUrl: 'https://drive.test/v3', driveId: 'D1', getToken: async () => 't', fetchImpl, sleep: async () => {}, ...extra });

test('listFiles interroge le Drive partagé avec les bons paramètres', async () => {
  const { calls, fetchImpl } = fakeFetch([[200, { files: [] }]]);
  await client(fetchImpl).listFiles();
  const params = calls[0].searchParams;
  assert.equal(calls[0].pathname, '/v3/files');
  assert.equal(params.get('corpora'), 'drive');
  assert.equal(params.get('driveId'), 'D1');
  assert.equal(params.get('supportsAllDrives'), 'true');
  assert.equal(params.get('includeItemsFromAllDrives'), 'true');
  assert.equal(params.get('q'), 'trashed = false');
  assert.equal(params.get('pageSize'), '1000');
  assert.match(params.get('fields'), /imageMediaMetadata\(width,height,time\)/);
});

test('reprise après 429, 403 rateLimitExceeded et 503', async () => {
  const rate = { error: { message: 'limite', errors: [{ reason: 'rateLimitExceeded' }] } };
  const { calls, fetchImpl } = fakeFetch([[429, {}], [403, rate], [503, {}], [200, { startPageToken: '42' }]]);
  assert.equal(await client(fetchImpl).getStartPageToken(), '42');
  assert.equal(calls.length, 4);
});

test('403 de droits (pas une limite de débit) : erreur immédiate', async () => {
  const { calls, fetchImpl } = fakeFetch([[403, { error: { message: 'interdit', errors: [{ reason: 'insufficientFilePermissions' }] } }]]);
  await assert.rejects(client(fetchImpl).getStartPageToken(), (err) => err instanceof DriveError && err.status === 403);
  assert.equal(calls.length, 1);
});

test("abandon après le nombre maximal d'essais", async () => {
  const { calls, fetchImpl } = fakeFetch(Array.from({ length: 3 }, () => [500, {}]));
  await assert.rejects(client(fetchImpl, { maxAttempts: 3 }).listChanges('1'), (err) => err.status === 500);
  assert.equal(calls.length, 3);
});
