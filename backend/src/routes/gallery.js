// Galerie photos (lecture seule) : albums et photos indexés depuis le Drive partagé par le service gallery-worker.
// Droits : canViewGallery / canManageGallery (auth.js). Les images passent par des liens signés (voir gallery/signing.js) :
// une balise <img> n'envoie pas l'en-tête Authorization.
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { authenticateToken, canViewGallery, canManageGallery, requireGallery } = require('../auth');
const config = require('../gallery/config');
const signing = require('../gallery/signing');
const galleryService = require('../gallery/galleryService');
const { getDriveClient, DriveError } = require('../gallery/driveClient');
const { thumbPath } = require('../gallery/thumbnails');

const USER_CACHE_MS = 60 * 1000;

// Droits relus au plus toutes les minutes pour les images (une page en affiche des dizaines)
function cachedUserLoader(load) {
  const cache = new Map();
  return async (userId) => {
    const hit = cache.get(userId);
    if (hit && hit.until > Date.now()) return hit.user;
    const user = await load(userId);
    if (cache.size > 1000) cache.clear();
    cache.set(userId, { user, until: Date.now() + USER_CACHE_MS });
    return user;
  };
}

// Nom de fichier pour Content-Disposition : version ASCII de repli + version UTF-8 (RFC 6266)
function contentDisposition(filename) {
  const ascii = filename.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '_') || 'photo';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

const parseId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id < 2 ** 31 ? id : null;
};

function createGalleryRouter({
  authenticate = authenticateToken,
  service = galleryService,
  drive = null, // client Drive (créé à la première demande d'original)
  loadUser = cachedUserLoader(service.getUserForAccess),
  signingOptions = {},
  thumbsDir = config.THUMBS_DIR,
  isEnabled = config.isEnabled,
} = {}) {
  const router = express.Router();
  const viewerOf = (req) => ({ id: req.user.id, canManage: canManageGallery(req.user) });

  // Lien d'image : signature valable ET membre ayant toujours accès à la galerie (un compte repassé prospect perd l'accès)
  const signedAccess = (kindOf) => async (req, res, next) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Photo introuvable' });
    const kind = kindOf(req);
    if (!kind) return res.status(400).json({ error: 'Taille de miniature inconnue (sm ou lg)' });
    const userId = signing.verify(kind, id, req.query, signingOptions);
    if (!userId) return res.status(403).json({ error: 'Lien expiré ou invalide : recharge la page' });
    if (!canViewGallery(await loadUser(userId))) return res.status(403).json({ error: 'Accès à la galerie refusé' });
    req.photoId = id;
    req.photoKind = kind;
    req.galleryUserId = userId;
    next();
  };

  const originalLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 150,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `gallery-original-${req.galleryUserId}`,
    handler: (req, res) => res.status(429).json({ error: 'Trop de téléchargements : réessaie dans quelques minutes.' }),
  });

  // GET /photos/:id/thumb?size=sm|lg&exp&u&sig — miniature depuis le volume du serveur
  router.get(
    '/photos/:id/thumb',
    signedAccess((req) => (['sm', 'lg'].includes(req.query.size) ? req.query.size : null)),
    async (req, res) => {
      const photo = await service.getPhotoFile(req.photoId);
      if (!photo) return res.status(404).json({ error: 'Photo introuvable' });
      if (photo.thumb_status !== 'ok') return res.status(404).json({ error: 'Miniature pas encore prête' });
      res.set('Cache-Control', 'private, max-age=86400');
      res.sendFile(thumbPath(photo.drive_file_id, req.photoKind, thumbsDir), { cacheControl: false, headers: { 'Content-Type': 'image/webp' } }, (err) => {
        if (err && !res.headersSent) res.status(404).json({ error: 'Miniature introuvable' });
      });
    }
  );

  // GET /photos/:id/original?exp&u&sig — original lu en flux depuis le Drive, en téléchargement
  router.get('/photos/:id/original', signedAccess(() => 'original'), originalLimit, async (req, res) => {
    const photo = await service.getPhotoFile(req.photoId);
    if (!photo) return res.status(404).json({ error: 'Photo introuvable' });
    let upstream;
    try {
      upstream = await (drive || getDriveClient()).download(photo.drive_file_id);
    } catch (err) {
      if (err instanceof DriveError && err.status === 404) return res.status(404).json({ error: 'Photo introuvable dans le Drive' });
      console.error('Galerie : original indisponible', err.message);
      return res.status(502).json({ error: 'Drive injoignable, réessaie dans un instant' });
    }
    res.set({
      'Content-Type': photo.mime_type,
      'Content-Disposition': contentDisposition(photo.filename),
      'Cache-Control': 'private, no-store',
    });
    const length = upstream.headers.get('content-length');
    if (length) res.set('Content-Length', length);
    try {
      await pipeline(Readable.fromWeb(upstream.body), res);
    } catch {
      res.destroy(); // téléchargement interrompu (visiteur parti ou Drive coupé)
    }
  });

  // Tout le reste : session de l'ERP, membres ayant accès à la galerie
  router.use(authenticate, requireGallery);
  const requireManager = (req, res, next) =>
    canManageGallery(req.user) ? next() : res.status(403).json({ error: 'Réservé aux membres du bureau' });

  // GET /albums — tous les albums visibles (à plat, avec parentId)
  router.get('/albums', async (req, res) => {
    const viewer = viewerOf(req);
    const albums = await service.listAlbums(viewer);
    res.json({
      albums,
      configured: isEnabled(),
      canManage: viewer.canManage,
      ...(viewer.canManage && isEnabled() && { driveUrl: config.folderUrl(config.DRIVE_ID) }),
    });
  });

  // GET /albums/:id — album, fil d'Ariane, sous-albums
  router.get('/albums/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const result = id && (await service.getAlbum(id, viewerOf(req)));
    if (!result) return res.status(404).json({ error: 'Album introuvable' });
    res.json(result);
  });

  // GET /albums/:id/photos?cursor=&limit=60 — photos par pages, les plus récentes d'abord
  router.get('/albums/:id/photos', async (req, res) => {
    const id = parseId(req.params.id);
    const result = id && (await service.listPhotos(id, { cursor: req.query.cursor, limit: req.query.limit }, viewerOf(req)));
    if (!result) return res.status(404).json({ error: 'Album introuvable' });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  });

  // GET /photos/:id — une photo (liens frais, place dans l'album) : lien partagé ?photo=ID, téléchargement
  router.get('/photos/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const result = id && (await service.getPhoto(id, viewerOf(req)));
    if (!result) return res.status(404).json({ error: 'Photo introuvable' });
    res.json(result);
  });

  // POST /sync — bureau : synchro incrémentale immédiate (faite par le worker)
  router.post('/sync', requireManager, async (req, res) => {
    if (!isEnabled()) return res.status(503).json({ error: 'Galerie non configurée (GALLERY_SHARED_DRIVE_ID)' });
    await service.requestSync('auto');
    res.status(202).json({ message: 'Synchronisation demandée' });
  });

  // GET /sync/status — bureau : dernière synchro, erreurs, chiffres
  router.get('/sync/status', requireManager, async (req, res) => {
    res.json(await service.getSyncStatus());
  });

  return router;
}

module.exports = createGalleryRouter();
module.exports.createGalleryRouter = createGalleryRouter;
module.exports.contentDisposition = contentDisposition;
