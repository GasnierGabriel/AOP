require('dotenv').config();
require('express-async-errors');

const express = require('express');
const cors = require('cors');
const { pool } = require('./db');
const { runMigrations } = require('./migrations/init');
const authRoutes = require('./routes/auth');
const googleRoutes = require('./routes/google');
const annuaireRoutes = require('./routes/annuaire');
const sponsoringRoutes = require('./routes/sponsoring');
const wikiRoutes = require('./routes/wiki');
const taskRoutes = require('./routes/tasks');
const { mountMcp, mcpApiRouter } = require('./mcp');
const { startNotificationScheduler } = require('./notifications/scheduler');

const PORT = Number(process.env.PORT) || 3000;
const app = express();
app.set('trust proxy', 1); // derrière Caddy : IP réelle des visiteurs (limites de débit)

// Serveur MCP et routes OAuth standard, avec leurs propres règles CORS et de lecture du corps
mountMcp(app);

app.use(cors({
  origin: (process.env.CORS_ORIGIN || 'http://localhost:3001').split(',').map((o) => o.trim()),
}));
app.use(express.json({ limit: '512kb' })); // pages du wiki : jusqu'à 100 000 caractères

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'ok' });
  } catch {
    res.status(503).json({ status: 'error', db: 'unreachable' });
  }
});

app.use('/api/auth/google', googleRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/annuaire', annuaireRoutes);
app.use('/api/sponsoring', sponsoringRoutes);
app.use('/api/wiki', wikiRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/mcp', mcpApiRouter);

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Route introuvable' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON invalide' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Contenu trop volumineux' });
  }
  console.error(err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: status >= 500 ? 'Erreur interne du serveur' : err.message });
});

async function waitForDatabase(retries = 10, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      console.log('✅ Connexion PostgreSQL OK');
      return;
    } catch (err) {
      console.warn(`⏳ PostgreSQL indisponible (tentative ${attempt}/${retries}) : ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

// Base prête et schéma à jour avant d'accepter des requêtes
waitForDatabase()
  .then(runMigrations)
  .then(() => {
    console.log('✅ Schéma de base à jour');
    app.listen(PORT, () => console.log(`🚀 API ARECE sur le port ${PORT}`));
    startNotificationScheduler();
  })
  .catch((err) => {
    console.error('❌ Démarrage impossible (PostgreSQL ou migration)', err);
    process.exit(1);
  });
