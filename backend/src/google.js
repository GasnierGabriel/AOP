// Connexion Google (OpenID Connect) restreinte au Google Workspace de l'association.
// Désactivée tant que GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET ne sont pas définis.
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const DOMAIN = (process.env.GOOGLE_WORKSPACE_DOMAIN || 'arece.eu').trim().toLowerCase();

// URL publique du site (frontend) et de l'API, telles que vues par le navigateur
const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:3001').replace(/\/+$/, '');
const API_PUBLIC_URL = (process.env.API_PUBLIC_URL || `${PUBLIC_URL}/api`).replace(/\/+$/, '');
const REDIRECT_URI = `${API_PUBLIC_URL}/auth/google/callback`;

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

const isEnabled = () => Boolean(CLIENT_ID && CLIENT_SECRET);

function authorizationUrl(state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    hd: DOMAIN, // propose directement les comptes du Workspace
    prompt: 'select_account',
  });
  return `${AUTH_ENDPOINT}?${params}`;
}

// Échange le code contre l'identité Google. L'id_token est reçu directement de Google
// (requête serveur à serveur en TLS) : on en vérifie les claims (OpenID Connect Core §3.1.3.7).
async function exchangeCode(code) {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id_token) {
    throw new Error(`échange du code refusé : ${data.error_description || data.error || response.status}`);
  }

  const claims = JSON.parse(Buffer.from(data.id_token.split('.')[1], 'base64url').toString('utf8'));
  if (!ISSUERS.includes(claims.iss)) throw new Error('émetteur inattendu');
  if (claims.aud !== CLIENT_ID) throw new Error('audience inattendue');
  if (!claims.exp || claims.exp * 1000 < Date.now()) throw new Error('jeton expiré');
  if (!claims.sub || !claims.email || claims.email_verified !== true) throw new Error('email Google non vérifié');

  return { sub: claims.sub, email: claims.email.toLowerCase(), hd: (claims.hd || '').toLowerCase() };
}

// Le compte doit appartenir au Workspace (claim hd) ET avoir une adresse du domaine
const belongsToWorkspace = (identity) => identity.hd === DOMAIN && identity.email.endsWith(`@${DOMAIN}`);

module.exports = {
  DOMAIN,
  PUBLIC_URL,
  REDIRECT_URI,
  isEnabled,
  authorizationUrl,
  exchangeCode,
  belongsToWorkspace,
};
