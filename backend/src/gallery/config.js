// Réglages de la galerie photos (variables d'environnement). Galerie désactivée tant que GALLERY_SHARED_DRIVE_ID est vide.
const crypto = require('crypto');

const DRIVE_ID = (process.env.GALLERY_SHARED_DRIVE_ID || '').trim();
const SYNC_INTERVAL_MINUTES = Math.max(1, Number(process.env.GALLERY_SYNC_INTERVAL_MINUTES) || 10);
const THUMBS_DIR = process.env.GALLERY_THUMBS_DIR || '/data/gallery/thumbs';

// Adresse de l'API Drive. Ne se change que pour les tests (faux Drive local), avec un jeton fixe à la place du compte de service.
const DRIVE_API_URL = (process.env.GALLERY_DRIVE_API_URL || 'https://www.googleapis.com/drive/v3').replace(/\/+$/, '');
const DRIVE_STATIC_TOKEN = process.env.GALLERY_DRIVE_STATIC_TOKEN || '';

// Secret des liens d'images signés : GALLERY_URL_SIGNING_SECRET, sinon dérivé de JWT_SECRET (une variable de moins à gérer)
const SIGNING_SECRET =
  process.env.GALLERY_URL_SIGNING_SECRET ||
  crypto.createHmac('sha256', process.env.JWT_SECRET || '').update('arece-gallery-url-signing').digest('hex');

const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

const THUMB_SIZES = {
  sm: { width: 400, quality: 75 }, // grille
  lg: { width: 1600, quality: 82 }, // visionneuse
};
const THUMB_CONCURRENCY = 2; // le serveur héberge aussi l'ERP : 2 photos à la fois au plus
const THUMB_MAX_ATTEMPTS = 3; // une photo en erreur est retentée 3 fois au plus (coupure réseau…)
const MAX_ORIGINAL_BYTES = 200 * 1024 * 1024; // au-delà, pas de miniature (fichier anormal pour une photo)

const isEnabled = () => Boolean(DRIVE_ID);
const folderUrl = (folderId) => `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;

module.exports = {
  DRIVE_ID,
  SYNC_INTERVAL_MINUTES,
  THUMBS_DIR,
  DRIVE_API_URL,
  DRIVE_STATIC_TOKEN,
  SIGNING_SECRET,
  ACCEPTED_MIME_TYPES,
  THUMB_SIZES,
  THUMB_CONCURRENCY,
  THUMB_MAX_ATTEMPTS,
  MAX_ORIGINAL_BYTES,
  isEnabled,
  folderUrl,
};
