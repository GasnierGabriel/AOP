// Liens d'images signés (HMAC) : l'ERP s'authentifie par un en-tête Authorization, qu'une balise <img> n'envoie pas.
// Chaque lien vaut pour une photo, une taille et un membre ; il expire au bout d'1 à 2 h. L'expiration est calée sur
// des créneaux d'une heure : le lien reste identique pendant ce créneau, donc le cache du navigateur sert.
const crypto = require('crypto');
const config = require('./config');

const WINDOW_SECONDS = 3600;
const KINDS = new Set(['sm', 'lg', 'original']);

function expiryFor(nowMs = Date.now(), windowSeconds = WINDOW_SECONDS) {
  return (Math.floor(nowMs / 1000 / windowSeconds) + 2) * windowSeconds;
}

const signature = (kind, photoId, userId, exp, secret) =>
  crypto.createHmac('sha256', secret).update(`gallery:${kind}:${photoId}:${userId}:${exp}`).digest('base64url');

// Paramètres à ajouter à l'adresse de l'image
function sign(kind, photoId, userId, { now = Date.now(), secret = config.SIGNING_SECRET } = {}) {
  if (!KINDS.has(kind)) throw new Error(`type de lien inconnu : ${kind}`);
  const exp = expiryFor(now);
  return { exp, u: userId, sig: signature(kind, photoId, userId, exp, secret) };
}

// Identifiant du membre si le lien est authentique et pas expiré, sinon null
function verify(kind, photoId, { exp, u, sig } = {}, { now = Date.now(), secret = config.SIGNING_SECRET } = {}) {
  const expiry = Number(exp);
  const userId = Number(u);
  if (!KINDS.has(kind) || !Number.isInteger(expiry) || !Number.isInteger(userId) || userId <= 0 || typeof sig !== 'string') return null;
  if (expiry * 1000 <= now || expiry * 1000 > now + 3 * WINDOW_SECONDS * 1000) return null;
  const expected = Buffer.from(signature(kind, photoId, userId, expiry, secret));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given) ? userId : null;
}

// Chemins relatifs à l'API (le frontend les préfixe par son adresse d'API)
function thumbUrl(photoId, size, userId, opts) {
  const { exp, u, sig } = sign(size, photoId, userId, opts);
  return `/gallery/photos/${photoId}/thumb?size=${size}&exp=${exp}&u=${u}&sig=${sig}`;
}
function originalUrl(photoId, userId, opts) {
  const { exp, u, sig } = sign('original', photoId, userId, opts);
  return `/gallery/photos/${photoId}/original?exp=${exp}&u=${u}&sig=${sig}`;
}

module.exports = { WINDOW_SECONDS, expiryFor, sign, verify, thumbUrl, originalUrl };
