require('dotenv').config();
const { Pool, types } = require('pg');

// Les colonnes DATE (OID 1082) sont renvoyées telles quelles ('2024-09-01')
// au lieu d'un objet Date, pour éviter les décalages de fuseau horaire.
types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
});

pool.on('error', (err) => {
  console.error('Erreur inattendue du pool PostgreSQL', err);
});

const query = (text, params) => pool.query(text, params);

module.exports = { query, pool };
