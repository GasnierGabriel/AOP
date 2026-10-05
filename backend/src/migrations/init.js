const { pool } = require('../db');

const SQL = `
DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('active', 'alumni', 'honorary', 'prospect');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(255) NOT NULL,
  linkedin_url  VARCHAR(500),
  status        user_status NOT NULL DEFAULT 'prospect',
  is_bureau     BOOLEAN NOT NULL DEFAULT FALSE,
  level         SMALLINT NOT NULL DEFAULT 1 CHECK (level IN (1, 2)),
  promo         INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS roles (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(150) NOT NULL UNIQUE,
  description TEXT,
  pole        VARCHAR(100),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_roles (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  pole       VARCHAR(100),
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date   DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS user_roles_user_id_idx ON user_roles (user_id);

CREATE TABLE IF NOT EXISTS competitions (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(200) NOT NULL,
  year       INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, year)
);

CREATE TABLE IF NOT EXISTS user_competitions (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  role           VARCHAR(100),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, competition_id)
);
CREATE INDEX IF NOT EXISTS user_competitions_user_id_idx ON user_competitions (user_id);

CREATE TABLE IF NOT EXISTS user_profile (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  bio          TEXT,
  achievements TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS auth_tokens_user_id_idx ON auth_tokens (user_id);

CREATE TABLE IF NOT EXISTS tags (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(40) NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS tags_name_lower_idx ON tags (LOWER(name));
-- Couleur (#rrggbb) et puce emoji façon rôles Discord
ALTER TABLE tags ADD COLUMN IF NOT EXISTS color VARCHAR(7) NOT NULL DEFAULT '#99aab5';
ALTER TABLE tags ADD COLUMN IF NOT EXISTS emoji VARCHAR(16);

CREATE TABLE IF NOT EXISTS user_tags (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  added_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, tag_id)
);
CREATE INDEX IF NOT EXISTS user_tags_tag_id_idx ON user_tags (tag_id);
`;

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(SQL);
    await client.query('COMMIT');
    console.log('✅ Migration terminée');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('❌ Échec de la migration', err);
  process.exit(1);
});
