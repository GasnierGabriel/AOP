// Serveur d'autorisation OAuth 2.1 du MCP (assistants IA : Claude, ChatGPT, Gemini…).
// Les routes standard (/authorize, /token, /register, /revoke, /.well-known/…) viennent du SDK MCP ;
// ce module fournit le stockage en base et l'étape « Autoriser » où le membre donne son accord dans l'ERP.
const crypto = require('crypto');
const { query } = require('../db');
const { hashToken, MCP_TOKEN_PREFIX, findMcpToken } = require('../auth');
const {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidTokenError,
} = require('@modelcontextprotocol/sdk/server/auth/errors.js');

const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost').replace(/\/+$/, '');
const MCP_URL = `${PUBLIC_URL}/mcp`;
const SCOPE = 'erp';

const REQUEST_TTL_MIN = 10; // demande d'autorisation en attente
const CODE_TTL_MIN = 5;
const ACCESS_TTL_S = 3600;
const REFRESH_TTL_DAYS = 30;
const PERSONAL_TTL_DAYS = 365;

const newSecret = () => MCP_TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');

// Adresses de retour acceptées : HTTPS, ou boucle locale pour les outils en ligne de commande
function isAllowedRedirect(uri) {
  try {
    const url = new URL(uri);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

const clientsStore = {
  async getClient(clientId) {
    const { rows } = await query('SELECT metadata FROM oauth_clients WHERE client_id = $1', [clientId]);
    return rows[0]?.metadata;
  },
  async registerClient(client) {
    if (!Array.isArray(client.redirect_uris) || !client.redirect_uris.every(isAllowedRedirect)) {
      throw new InvalidClientMetadataError('redirect_uris : HTTPS obligatoire (ou http://localhost)');
    }
    await query('INSERT INTO oauth_clients (client_id, metadata) VALUES ($1, $2)', [client.client_id, client]);
    return client;
  },
};

async function issueTokens(client, userId, scopes, resource) {
  const access = newSecret();
  const refresh = newSecret();
  const insert = (hash, kind, expiresSql) =>
    query(
      `INSERT INTO oauth_tokens (token_hash, kind, client_id, user_id, scopes, resource, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, ${expiresSql})`,
      [hash, kind, client.client_id, userId, scopes, resource || null]
    );
  await insert(hashToken(access), 'access', `NOW() + INTERVAL '${ACCESS_TTL_S} seconds'`);
  await insert(hashToken(refresh), 'refresh', `NOW() + INTERVAL '${REFRESH_TTL_DAYS} days'`);
  return {
    access_token: access,
    token_type: 'bearer',
    expires_in: ACCESS_TTL_S,
    refresh_token: refresh,
    scope: scopes.join(' '),
  };
}

const provider = {
  clientsStore,

  // Étape 1 : la demande est mise de côté et le membre est envoyé sur la page « Autoriser » de l'ERP
  async authorize(client, params, res) {
    const id = crypto.randomBytes(24).toString('base64url');
    await query("DELETE FROM oauth_requests WHERE expires_at < NOW() - INTERVAL '1 day'");
    await query(
      `INSERT INTO oauth_requests (id, client_id, params, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '${REQUEST_TTL_MIN} minutes')`,
      [
        id,
        client.client_id,
        {
          redirectUri: params.redirectUri,
          state: params.state ?? null,
          codeChallenge: params.codeChallenge,
          scopes: params.scopes?.length ? params.scopes : [SCOPE],
          resource: params.resource ? params.resource.href : null,
        },
      ]
    );
    res.redirect(`${PUBLIC_URL}/autoriser-assistant?demande=${id}`);
  },

  async challengeForAuthorizationCode(client, code) {
    const { rows } = await query(
      'SELECT code_challenge FROM oauth_codes WHERE code_hash = $1 AND client_id = $2 AND used_at IS NULL AND expires_at > NOW()',
      [hashToken(code), client.client_id]
    );
    if (rows.length === 0) throw new InvalidGrantError('Code invalide ou expiré');
    return rows[0].code_challenge;
  },

  async exchangeAuthorizationCode(client, code, _verifier, redirectUri, resource) {
    const { rows } = await query(
      `UPDATE oauth_codes SET used_at = NOW()
        WHERE code_hash = $1 AND client_id = $2 AND used_at IS NULL AND expires_at > NOW()
        RETURNING user_id, redirect_uri, scopes, resource`,
      [hashToken(code), client.client_id]
    );
    const grant = rows[0];
    if (!grant) throw new InvalidGrantError('Code invalide, expiré ou déjà utilisé');
    if (redirectUri && redirectUri !== grant.redirect_uri) throw new InvalidGrantError('redirect_uri différente');
    if (resource && grant.resource && resource.href !== grant.resource) throw new InvalidGrantError('Ressource différente');
    return issueTokens(client, grant.user_id, grant.scopes, grant.resource);
  },

  // Renouvellement : l'ancien jeton de renouvellement est consommé (rotation)
  async exchangeRefreshToken(client, refreshToken) {
    const { rows } = await query(
      `UPDATE oauth_tokens SET revoked_at = NOW()
        WHERE token_hash = $1 AND kind = 'refresh' AND client_id = $2 AND revoked_at IS NULL AND expires_at > NOW()
        RETURNING user_id, scopes, resource`,
      [hashToken(refreshToken), client.client_id]
    );
    const grant = rows[0];
    if (!grant) throw new InvalidGrantError('Jeton de renouvellement invalide ou expiré');
    return issueTokens(client, grant.user_id, grant.scopes, grant.resource);
  },

  async verifyAccessToken(token) {
    const found = await findMcpToken(token);
    if (!found) throw new InvalidTokenError('Jeton invalide, expiré ou révoqué');
    return {
      token,
      clientId: found.client_id || 'jeton-personnel',
      scopes: found.scopes,
      expiresAt: Math.floor(new Date(found.expires_at).getTime() / 1000),
      resource: found.resource ? new URL(found.resource) : undefined,
      extra: { userId: found.user_id },
    };
  },

  async revokeToken(client, { token }) {
    await query('UPDATE oauth_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND client_id = $2 AND revoked_at IS NULL', [
      hashToken(token),
      client.client_id,
    ]);
  },
};

/* ---------- Étape « Autoriser » (appelée par la page de l'ERP, membre connecté) ---------- */

async function getRequest(id) {
  const { rows } = await query(
    `SELECT r.id, r.params, c.metadata FROM oauth_requests r JOIN oauth_clients c ON c.client_id = r.client_id
      WHERE r.id = $1 AND r.expires_at > NOW()`,
    [id]
  );
  return rows[0] || null;
}

function describeClient(metadata, redirectUri) {
  return {
    name: String(metadata.client_name || 'Application sans nom').slice(0, 100),
    website: metadata.client_uri || null,
    redirectHost: new URL(redirectUri).host,
  };
}

function redirectWith(redirectUri, values) {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(values)) if (v !== null && v !== undefined) url.searchParams.set(k, v);
  return url.toString();
}

// Accord du membre : code à usage unique renvoyé à l'assistant
async function approveRequest(id, userId) {
  const request = await getRequest(id);
  if (!request) return null;
  await query('DELETE FROM oauth_requests WHERE id = $1', [id]);
  const code = crypto.randomBytes(32).toString('base64url');
  const p = request.params;
  await query(
    `INSERT INTO oauth_codes (code_hash, client_id, user_id, code_challenge, redirect_uri, scopes, resource, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '${CODE_TTL_MIN} minutes')`,
    [hashToken(code), request.metadata.client_id, userId, p.codeChallenge, p.redirectUri, p.scopes, p.resource]
  );
  return redirectWith(p.redirectUri, { code, state: p.state, iss: PUBLIC_URL });
}

async function denyRequest(id) {
  const request = await getRequest(id);
  if (!request) return null;
  await query('DELETE FROM oauth_requests WHERE id = $1', [id]);
  return redirectWith(request.params.redirectUri, {
    error: 'access_denied',
    error_description: "Accès refusé par le membre",
    state: request.params.state,
    iss: PUBLIC_URL,
  });
}

async function createPersonalToken(userId, label) {
  const token = newSecret();
  const { rows } = await query(
    `INSERT INTO oauth_tokens (token_hash, kind, user_id, label, scopes, resource, expires_at)
     VALUES ($1, 'personal', $2, $3, $4, $5, NOW() + INTERVAL '${PERSONAL_TTL_DAYS} days')
     RETURNING id, label, created_at, expires_at`,
    [hashToken(token), userId, label, [SCOPE], MCP_URL]
  );
  return { token, info: rows[0] };
}

module.exports = {
  provider,
  getRequest,
  describeClient,
  approveRequest,
  denyRequest,
  createPersonalToken,
  PUBLIC_URL,
  MCP_URL,
  SCOPE,
};
