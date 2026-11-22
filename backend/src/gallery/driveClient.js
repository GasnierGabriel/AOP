// Accès en lecture seule au Drive partagé de la galerie (API REST Drive v3).
// Identifiants : Application Default Credentials de google-auth-library (fichier de clé désigné par
// GOOGLE_APPLICATION_CREDENTIALS, ou compte de service attaché à la machine sur Google Cloud).
const config = require('./config');

const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FILE_FIELDS = 'id,name,mimeType,parents,size,md5Checksum,createdTime,modifiedTime,trashed,imageMediaMetadata(width,height,time)';
const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'backendError']);
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

class DriveError extends Error {
  constructor(message, status, reason) {
    super(message);
    this.name = 'DriveError';
    this.status = status;
    this.reason = reason;
  }
}

let googleAuth = null;
async function serviceAccountToken() {
  if (config.DRIVE_STATIC_TOKEN) return config.DRIVE_STATIC_TOKEN;
  if (!googleAuth) {
    const { GoogleAuth } = require('google-auth-library');
    googleAuth = new GoogleAuth({ scopes: SCOPES });
  }
  const client = await googleAuth.getClient();
  const { token } = await client.getAccessToken(); // mis en cache et renouvelé par la bibliothèque
  if (!token) throw new DriveError('Aucun jeton Google obtenu (identifiants du compte de service ?)', 401);
  return token;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Client Drive ; les dépendances sont injectables pour les tests
function createDriveClient({
  apiUrl = config.DRIVE_API_URL,
  driveId = config.DRIVE_ID,
  getToken = serviceAccountToken,
  fetchImpl = (...args) => fetch(...args),
  sleep = defaultSleep,
  maxAttempts = 6,
} = {}) {
  const sharedDrive = { driveId, supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' };

  // Requête avec reprise exponentielle sur limite de débit (403/429) et erreurs serveur (5xx) ou réseau
  async function request(path, params = {}, { raw = false, timeoutMs = 60000 } = {}) {
    const url = new URL(`${apiUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    for (let attempt = 1; ; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(url, {
          headers: { Authorization: `Bearer ${await getToken()}` },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        if (err instanceof DriveError) throw err;
        if (attempt >= maxAttempts) throw new DriveError(`Drive injoignable : ${err.message}`, 0);
        await sleep(backoff(attempt));
        continue;
      }
      if (response.ok) return raw ? response : response.json();

      const body = await response.json().catch(() => ({}));
      const reason = body?.error?.errors?.[0]?.reason || body?.error?.status;
      const retryable = RETRY_STATUSES.has(response.status) || (response.status === 403 && RATE_LIMIT_REASONS.has(reason));
      if (retryable && attempt < maxAttempts) {
        await sleep(backoff(attempt));
        continue;
      }
      throw new DriveError(`Drive ${response.status} : ${body?.error?.message || response.statusText}`, response.status, reason);
    }
  }

  return {
    driveId,
    // Une page de la liste complète du Drive (fichiers et dossiers non supprimés), ou des enfants d'un dossier
    listFiles({ pageToken, parentId } = {}) {
      const q = parentId ? `'${parentId.replace(/'/g, "\\'")}' in parents and trashed = false` : 'trashed = false';
      return request('/files', {
        ...sharedDrive,
        corpora: 'drive',
        q,
        pageSize: 1000,
        pageToken,
        fields: `nextPageToken,files(${FILE_FIELDS})`,
      });
    },
    async getStartPageToken() {
      const data = await request('/changes/startPageToken', { driveId, supportsAllDrives: 'true' });
      return data.startPageToken;
    },
    listChanges(pageToken) {
      return request('/changes', {
        ...sharedDrive,
        pageToken,
        pageSize: 1000,
        includeRemoved: 'true',
        fields: `nextPageToken,newStartPageToken,changes(changeType,removed,fileId,file(${FILE_FIELDS}))`,
      });
    },
    getFile(fileId) {
      return request(`/files/${encodeURIComponent(fileId)}`, { supportsAllDrives: 'true', fields: FILE_FIELDS });
    },
    // Fichier original (réponse HTTP brute, à lire en flux)
    download(fileId, { timeoutMs = 5 * 60 * 1000 } = {}) {
      return request(`/files/${encodeURIComponent(fileId)}`, { alt: 'media', supportsAllDrives: 'true' }, { raw: true, timeoutMs });
    },
  };
}

// 1 s, 2 s, 4 s, 8 s… (+ jusqu'à 1 s au hasard), plafonné à 1 min
function backoff(attempt) {
  return Math.min(2 ** (attempt - 1) * 1000 + Math.floor(Math.random() * 1000), 60000);
}

let defaultClient = null;
const getDriveClient = () => {
  if (!defaultClient) defaultClient = createDriveClient();
  return defaultClient;
};

module.exports = { FOLDER_MIME, FILE_FIELDS, DriveError, createDriveClient, getDriveClient, backoff };
