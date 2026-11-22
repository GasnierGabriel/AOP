// Traduction des fichiers du Drive en albums et photos de la galerie (fonctions pures, sans base ni réseau)
const { ACCEPTED_MIME_TYPES } = require('./config');
const { FOLDER_MIME } = require('./driveClient');

const UNSORTED_ALBUM_NAME = 'Non classé'; // photos déposées à la racine du Drive partagé
const ACCEPTED = new Set(ACCEPTED_MIME_TYPES);
const TIME_ZONE = 'Europe/Paris';

// Certains envois depuis un iPhone arrivent sans type précis : on se fie alors à l'extension
function effectiveMimeType(file) {
  const mime = (file.mimeType || '').toLowerCase();
  if (ACCEPTED.has(mime)) return mime;
  if (mime === 'application/octet-stream' || mime === '') {
    const ext = (file.name || '').toLowerCase().split('.').pop();
    if (ext === 'heic') return 'image/heic';
    if (ext === 'heif') return 'image/heif';
  }
  return mime;
}

// Décalage de Paris par rapport à UTC à un instant donné (heure d'été comprise), en millisecondes
function parisOffsetMs(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// Heure « murale » de Paris → instant réel
function parisLocalToDate(y, mo, d, h, mi, s) {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  let instant = wall - parisOffsetMs(new Date(wall));
  const recheck = wall - parisOffsetMs(new Date(instant)); // changement d'heure entre les deux estimations
  if (recheck !== instant) instant = recheck;
  return new Date(instant);
}

// Date de prise de vue EXIF (« 2024:05:12 14:03:22 », heure locale de l'appareil, supposée être Paris),
// sinon date d'ajout au Drive
function parseTakenAt(file) {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(file.imageMediaMetadata?.time || '');
  if (match) {
    const [y, mo, d, h, mi, s] = match.slice(1).map(Number);
    const date = parisLocalToDate(y, mo, d, h, mi, s);
    const plausible = y >= 1990 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && date.getTime() <= Date.now() + 86400000;
    if (plausible && !Number.isNaN(date.getTime())) return date;
  }
  const created = new Date(file.createdTime || file.modifiedTime || Date.now());
  return Number.isNaN(created.getTime()) ? new Date() : created;
}

const toDate = (value) => (value ? new Date(value) : null);
const toInt = (value) => (Number.isFinite(Number(value)) && value !== null && value !== undefined ? Math.round(Number(value)) : null);

// Un fichier du Drive → { kind: 'folder' | 'photo' | 'ignored', ... }
// driveId : identifiant du Drive partagé, qui est aussi le « dossier » parent des éléments posés à sa racine
function classifyFile(file, driveId) {
  if (!file?.id) return { kind: 'ignored', reason: 'other' };
  const parent = file.parents?.[0] || driveId;
  const trashed = Boolean(file.trashed);

  if (file.mimeType === FOLDER_MIME) {
    return {
      kind: 'folder',
      trashed,
      album: {
        driveFolderId: file.id,
        driveParentId: parent === driveId ? null : parent, // dossier à la racine : album de premier niveau
        name: (file.name || 'Sans nom').slice(0, 500),
      },
    };
  }

  const mimeType = effectiveMimeType(file);
  if (ACCEPTED.has(mimeType)) {
    return {
      kind: 'photo',
      trashed,
      photo: {
        driveFileId: file.id,
        driveParentId: parent, // racine du Drive → album « Non classé » (drive_folder_id = driveId)
        filename: (file.name || 'photo').slice(0, 500),
        mimeType,
        sizeBytes: toInt(file.size),
        md5Checksum: file.md5Checksum || null,
        width: toInt(file.imageMediaMetadata?.width),
        height: toInt(file.imageMediaMetadata?.height),
        takenAt: parseTakenAt(file),
        driveCreatedAt: toDate(file.createdTime),
        driveModifiedAt: toDate(file.modifiedTime),
      },
    };
  }

  return { kind: 'ignored', reason: mimeType.startsWith('video/') ? 'video' : 'other' };
}

// Un élément de changes.list → { kind: 'removed', fileId } ou le classement du fichier
function classifyChange(change, driveId) {
  if (change.changeType && change.changeType !== 'file') return { kind: 'ignored', reason: 'drive' };
  if (change.removed || !change.file) return { kind: 'removed', fileId: change.fileId };
  return classifyFile(change.file, driveId);
}

module.exports = { UNSORTED_ALBUM_NAME, classifyFile, classifyChange, parseTakenAt, parisLocalToDate, effectiveMimeType };
