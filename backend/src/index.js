require('dotenv').config();
require('express-async-errors');

const express = require('express');
const cors = require('cors');
const { pool } = require('./db');
const authRoutes = require('./routes/auth');
const annuaireRoutes = require('./routes/annuaire');

const PORT = Number(process.env.PORT) || 3000;
const app = express();

app.use(cors({
  origin: (process.env.CORS_ORIGIN || 'http://localhost:3001').split(',').map((o) => o.trim()),
}));
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'ok' });
  } catch {
    res.status(503).json({ status: 'error', db: 'unreachable' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/annuaire', annuaireRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Route introuvable' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON invalide' });
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

waitForDatabase()
  .then(() => {
    app.listen(PORT, () => console.log(`🚀 API ARECE sur le port ${PORT}`));
  })
  .catch((err) => {
    console.error('❌ Impossible de se connecter à PostgreSQL', err);
    process.exit(1);
  });
