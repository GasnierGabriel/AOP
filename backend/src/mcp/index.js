// Serveur MCP distant (https://<domaine>/mcp) pour les assistants IA : Claude, ChatGPT, Gemini / Antigravity…
// Transport Streamable HTTP sans session ; connexion OAuth 2.1 (enregistrement dynamique, PKCE) ou jeton personnel.
const express = require('express');
const cors = require('cors');
const {
  createOAuthMetadata,
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl,
} = require('@modelcontextprotocol/sdk/server/auth/router.js');
const { requireBearerAuth } = require('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { query } = require('../db');
const { authenticateToken, requireMember, userColumns } = require('../auth');
const { hasSponsoringAccess } = require('../sponsoring');
const oauth = require('./oauth');
const { buildServer } = require('./tools');

// Routes OAuth standard + point d'entrée /mcp (à monter avant les autres middlewares de l'API)
function mountMcp(app) {
  // Métadonnées OAuth publiées par nos soins, avant celles du SDK : l'émetteur (issuer) doit être exactement
  // l'adresse sous laquelle elles sont publiées, sans « / » final (le SDK en ajoute un), et identique au
  // paramètre iss renvoyé après l'autorisation. Claude refuse la connexion sinon.
  const metadataCors = cors({ origin: '*' });
  const authServerMetadata = {
    ...createOAuthMetadata({
      provider: oauth.provider,
      issuerUrl: new URL(oauth.PUBLIC_URL),
      serviceDocumentationUrl: new URL(`${oauth.PUBLIC_URL}/connexion`),
      scopesSupported: [oauth.SCOPE],
    }),
    issuer: oauth.PUBLIC_URL,
    authorization_response_iss_parameter_supported: true,
  };
  const resourceMetadata = {
    resource: oauth.MCP_URL,
    authorization_servers: [oauth.PUBLIC_URL],
    scopes_supported: [oauth.SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'ERP ARECE',
    resource_documentation: `${oauth.PUBLIC_URL}/connexion`,
  };
  app.options(['/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], metadataCors);
  app.get('/.well-known/oauth-authorization-server', metadataCors, (req, res) => res.json(authServerMetadata));
  app.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], metadataCors, (req, res) =>
    res.json(resourceMetadata)
  );

  app.use(
    mcpAuthRouter({
      provider: oauth.provider,
      issuerUrl: new URL(oauth.PUBLIC_URL),
      resourceServerUrl: new URL(oauth.MCP_URL),
      resourceName: 'ERP ARECE',
      serviceDocumentationUrl: new URL(`${oauth.PUBLIC_URL}/connexion`),
      scopesSupported: [oauth.SCOPE],
      // Les assistants appellent depuis leurs serveurs : beaucoup de membres derrière une même IP
      authorizationOptions: { rateLimit: { windowMs: 15 * 60 * 1000, max: 300 } },
      tokenOptions: { rateLimit: { windowMs: 15 * 60 * 1000, max: 600 } },
      clientRegistrationOptions: { rateLimit: { windowMs: 60 * 60 * 1000, max: 60 } },
    })
  );

  const bearer = requireBearerAuth({
    verifier: oauth.provider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(oauth.MCP_URL)),
  });
  const mcpCors = cors({ origin: '*', exposedHeaders: ['WWW-Authenticate', 'Mcp-Session-Id'] });

  app.options('/mcp', mcpCors);
  app.post('/mcp', mcpCors, express.json({ limit: '1mb' }), bearer, async (req, res) => {
    const { rows } = await query(`SELECT ${userColumns()} FROM users WHERE id = $1`, [req.auth.extra.userId]);
    const user = rows[0];
    if (!user || (user.status === 'prospect' && !user.is_bureau)) {
      return res.status(403).json({ error: 'Compte en attente de validation par le bureau' });
    }
    const me = {
      id: user.id,
      fullName: user.full_name,
      isBureau: user.is_bureau,
      canSponsoring: await hasSponsoringAccess(user),
    };
    const server = buildServer({ token: req.auth.token, me });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  // Mode sans session : pas de flux SSE ni de fermeture de session
  const notAllowed = (req, res) =>
    res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Méthode non autorisée' }, id: null });
  app.get('/mcp', mcpCors, notAllowed);
  app.delete('/mcp', mcpCors, notAllowed);
}

/* ---------- API de l'ERP : page « Autoriser » et gestion des accès (membre connecté) ---------- */

const router = express.Router();
router.use(authenticateToken, requireMember);

// GET /api/mcp/demandes/:id — demande d'autorisation en attente
router.get('/demandes/:id', async (req, res) => {
  const request = await oauth.getRequest(req.params.id);
  if (!request) return res.status(404).json({ error: 'Demande introuvable ou expirée : relance la connexion depuis ton assistant' });
  res.json({
    client: oauth.describeClient(request.metadata, request.params.redirectUri),
    canSponsoring: await hasSponsoringAccess(req.user),
  });
});

router.post('/demandes/:id/accepter', async (req, res) => {
  const redirect = await oauth.approveRequest(req.params.id, req.user.id);
  if (!redirect) return res.status(404).json({ error: 'Demande introuvable ou expirée : relance la connexion depuis ton assistant' });
  res.json({ redirect });
});

router.post('/demandes/:id/refuser', async (req, res) => {
  const redirect = await oauth.denyRequest(req.params.id);
  if (!redirect) return res.status(404).json({ error: 'Demande introuvable ou expirée' });
  res.json({ redirect });
});

// GET /api/mcp/acces — assistants connectés et jetons personnels du membre
router.get('/acces', async (req, res) => {
  const [apps, tokens] = await Promise.all([
    query(
      `SELECT t.client_id, c.metadata->>'client_name' AS name, MIN(t.created_at) AS connected_at, MAX(t.last_used_at) AS last_used_at
         FROM oauth_tokens t JOIN oauth_clients c ON c.client_id = t.client_id
        WHERE t.user_id = $1 AND t.kind IN ('access', 'refresh') AND t.revoked_at IS NULL AND t.expires_at > NOW()
        GROUP BY t.client_id, c.metadata->>'client_name' ORDER BY MIN(t.created_at) DESC`,
      [req.user.id]
    ),
    query(
      `SELECT id, label, created_at, expires_at, last_used_at FROM oauth_tokens
        WHERE user_id = $1 AND kind = 'personal' AND revoked_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC`,
      [req.user.id]
    ),
  ]);
  res.json({
    mcpUrl: oauth.MCP_URL,
    apps: apps.rows.map((r) => ({ clientId: r.client_id, name: r.name || 'Application sans nom', connectedAt: r.connected_at, lastUsedAt: r.last_used_at })),
    tokens: tokens.rows.map((r) => ({ id: r.id, label: r.label, createdAt: r.created_at, expiresAt: r.expires_at, lastUsedAt: r.last_used_at })),
  });
});

// DELETE /api/mcp/apps/:clientId — déconnecte un assistant (tous ses jetons pour ce membre)
router.delete('/apps/:clientId', async (req, res) => {
  const { rowCount } = await query(
    'UPDATE oauth_tokens SET revoked_at = NOW() WHERE user_id = $1 AND client_id = $2 AND revoked_at IS NULL',
    [req.user.id, req.params.clientId]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'Assistant introuvable' });
  res.status(204).end();
});

// POST /api/mcp/jetons { label } — jeton personnel (affiché une seule fois), pour les outils sans OAuth
router.post('/jetons', async (req, res) => {
  const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
  if (!label || label.length > 100) return res.status(400).json({ error: 'Donne un nom au jeton (100 caractères max)' });
  const { rows } = await query(
    "SELECT COUNT(*)::int AS n FROM oauth_tokens WHERE user_id = $1 AND kind = 'personal' AND revoked_at IS NULL AND expires_at > NOW()",
    [req.user.id]
  );
  if (rows[0].n >= 10) return res.status(400).json({ error: '10 jetons actifs maximum : révoque ceux qui ne servent plus' });
  const { token, info } = await oauth.createPersonalToken(req.user.id, label);
  res.status(201).json({
    token,
    info: { id: info.id, label: info.label, createdAt: info.created_at, expiresAt: info.expires_at, lastUsedAt: null },
  });
});

router.delete('/jetons/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Identifiant invalide' });
  const { rowCount } = await query(
    "UPDATE oauth_tokens SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND kind = 'personal' AND revoked_at IS NULL",
    [id, req.user.id]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'Jeton introuvable' });
  res.status(204).end();
});

module.exports = { mountMcp, mcpApiRouter: router };
