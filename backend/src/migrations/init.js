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
-- Compte Google Workspace ARECE lié (SSO) : identifiant Google stable + adresse affichée
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_email VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_linked_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_idx ON users (google_sub) WHERE google_sub IS NOT NULL;

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
-- Noms de rôles uniques sans tenir compte de la casse ("Trésorier" = "trésorier")
CREATE UNIQUE INDEX IF NOT EXISTS roles_name_lower_idx ON roles (LOWER(name));

CREATE TABLE IF NOT EXISTS competitions (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(200) NOT NULL,
  year       INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, year)
);
CREATE UNIQUE INDEX IF NOT EXISTS competitions_name_lower_year_idx ON competitions (LOWER(name), year);

CREATE TABLE IF NOT EXISTS user_competitions (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  events         JSONB NOT NULL DEFAULT '[]',  -- épreuves préparées : [{ "name": "...", "rank": 1 | null }]
  result         SMALLINT CHECK (result IS NULL OR result >= 1),  -- classement général (Challenge Awake)
  comment        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, competition_id)
);
-- Bases existantes : anciennes colonnes "role" (texte) puis "roles" (liste) converties en "events"
ALTER TABLE user_competitions ADD COLUMN IF NOT EXISTS events JSONB NOT NULL DEFAULT '[]';
ALTER TABLE user_competitions ADD COLUMN IF NOT EXISTS result SMALLINT CHECK (result IS NULL OR result >= 1);
ALTER TABLE user_competitions ADD COLUMN IF NOT EXISTS comment TEXT;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'user_competitions' AND column_name = 'role') THEN
    UPDATE user_competitions SET events = jsonb_build_array(jsonb_build_object('name', role, 'rank', NULL))
     WHERE role IS NOT NULL AND events = '[]';
    ALTER TABLE user_competitions DROP COLUMN role;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'user_competitions' AND column_name = 'roles') THEN
    UPDATE user_competitions
       SET events = (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', r, 'rank', NULL)), '[]')
                       FROM unnest(roles) AS r)
     WHERE events = '[]';
    ALTER TABLE user_competitions DROP COLUMN roles;
  END IF;
END $$;
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

-- Mot de passe oublié : liens de réinitialisation à usage unique (jeton haché, valable 1 h)
CREATE TABLE IF NOT EXISTS password_resets (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets (user_id, created_at DESC);

-- Serveur MCP (assistants IA : Claude, ChatGPT, Gemini…) : OAuth 2.1 avec enregistrement dynamique des clients
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id  VARCHAR(100) PRIMARY KEY,
  metadata   JSONB NOT NULL,          -- informations du client telles qu'enregistrées (nom, redirect_uris…)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Demandes d'autorisation en attente de l'accord du membre (page « Autoriser » de l'ERP)
CREATE TABLE IF NOT EXISTS oauth_requests (
  id         VARCHAR(64) PRIMARY KEY,
  client_id  VARCHAR(100) NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  params     JSONB NOT NULL,          -- redirect_uri, state, code_challenge, scopes, resource
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Codes d'autorisation (usage unique, 5 min) et jetons (accès 1 h, renouvellement 30 j, personnels 1 an), hachés
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash      VARCHAR(64) PRIMARY KEY,
  client_id      VARCHAR(100) NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_challenge VARCHAR(200) NOT NULL,
  redirect_uri   TEXT NOT NULL,
  scopes         TEXT[] NOT NULL DEFAULT '{}',
  resource       TEXT,
  expires_at     TIMESTAMPTZ NOT NULL,
  used_at        TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id           SERIAL PRIMARY KEY,
  token_hash   VARCHAR(64) NOT NULL UNIQUE,
  kind         VARCHAR(10) NOT NULL CHECK (kind IN ('access', 'refresh', 'personal')),
  client_id    VARCHAR(100) REFERENCES oauth_clients(client_id) ON DELETE CASCADE,  -- NULL : jeton personnel
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label        VARCHAR(100),          -- nom donné à un jeton personnel
  scopes       TEXT[] NOT NULL DEFAULT '{}',
  resource     TEXT,
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS oauth_tokens_user_idx ON oauth_tokens (user_id, kind);

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

-- ERP Sponsoring : suivi des partenaires (accès : bureau ou tag « Sponsoring »)
DO $$ BEGIN
  CREATE TYPE sponsor_status AS ENUM ('to_contact', 'contacted', 'negotiation', 'signed', 'declined');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS sponsors (
  id                   SERIAL PRIMARY KEY,
  name                 VARCHAR(200) NOT NULL,
  status               sponsor_status NOT NULL DEFAULT 'to_contact',
  contribution_type    VARCHAR(20) NOT NULL DEFAULT 'money'
                       CHECK (contribution_type IN ('money', 'material', 'service', 'mixed')),
  amount               NUMERIC(10, 2) CHECK (amount IS NULL OR amount >= 0),  -- montant ou valeur estimée (€)
  contribution_details TEXT,
  contact_name         VARCHAR(200),
  contact_email        VARCHAR(255),
  contact_phone        VARCHAR(50),
  website              VARCHAR(500),
  owner_id             INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- membre en charge
  next_action_date     DATE,                                             -- prochaine relance
  notes                TEXT,
  created_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS sponsors_name_lower_idx ON sponsors (LOWER(name));

-- Rangs de sponsoring (obligatoire une fois signé) : Bronze, Argent, Or, Platine + rangs créés par l'équipe
CREATE TABLE IF NOT EXISTS sponsor_tiers (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(40) NOT NULL,
  color      VARCHAR(7) NOT NULL DEFAULT '#99aab5',
  position   INTEGER NOT NULL DEFAULT 0,  -- ordre d'importance croissant
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS sponsor_tiers_name_lower_idx ON sponsor_tiers (LOWER(name));
-- Rangs de départ, créés une seule fois (l'équipe peut ensuite les modifier ou les supprimer)
INSERT INTO sponsor_tiers (name, color, position)
SELECT * FROM (VALUES ('Bronze', '#cd7f32', 1), ('Argent', '#9ea3a8', 2), ('Or', '#d4a017', 3), ('Platine', '#6f8fa3', 4))
  AS v(name, color, position)
WHERE NOT EXISTS (SELECT 1 FROM sponsor_tiers);
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS tier_id INTEGER REFERENCES sponsor_tiers(id) ON DELETE RESTRICT;
-- Fonction de la personne contactée (ex : directeur marketing Europe, assistante qui fait suivre…)
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS contact_role VARCHAR(200);
-- Responsable hors équipe Sponsoring, saisi à la main (exclusif avec owner_id)
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS owner_external VARCHAR(200);

-- Contreparties promises au partenaire (logo, posts, invitations…), datées ou non, cochées une fois faites
CREATE TABLE IF NOT EXISTS sponsor_counterparts (
  id         SERIAL PRIMARY KEY,
  sponsor_id INTEGER NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  label      VARCHAR(300) NOT NULL,
  details    TEXT,
  due_date   DATE,
  done_at    TIMESTAMPTZ,
  position   INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sponsor_counterparts_sponsor_idx ON sponsor_counterparts (sponsor_id);

-- Plusieurs contacts par partenaire. Les colonnes contact_* de sponsors restent le miroir du premier contact
-- (tenu à jour par l'API) : la reprise ci-dessous ne peut donc jamais recréer un contact supprimé.
CREATE TABLE IF NOT EXISTS sponsor_contacts (
  id         SERIAL PRIMARY KEY,
  sponsor_id INTEGER NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  name       VARCHAR(200),
  role       VARCHAR(200),
  email      VARCHAR(255),
  phone      VARCHAR(50),
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sponsor_contacts_sponsor_idx ON sponsor_contacts (sponsor_id);
-- Reprise du contact unique d'avant (partenaires qui n'ont encore aucun contact enregistré)
INSERT INTO sponsor_contacts (sponsor_id, name, role, email, phone, position)
SELECT s.id, s.contact_name, s.contact_role, s.contact_email, s.contact_phone, 0
  FROM sponsors s
 WHERE COALESCE(s.contact_name, s.contact_role, s.contact_email, s.contact_phone) IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sponsor_contacts c WHERE c.sponsor_id = s.id);

-- Wiki de l'asso : catégories, pages (Markdown) et historique des versions
CREATE TABLE IF NOT EXISTS wiki_categories (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(80) NOT NULL,
  slug        VARCHAR(80) NOT NULL UNIQUE,
  emoji       VARCHAR(16),
  description VARCHAR(300),
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS wiki_categories_name_lower_idx ON wiki_categories (LOWER(name));
-- Catégories de départ, créées une seule fois (le bureau peut ensuite les modifier ou les supprimer)
INSERT INTO wiki_categories (name, slug, emoji, description, position)
SELECT * FROM (VALUES
  ('Administratif', 'administratif', '📋', 'Statuts, assurances, démarches école et préfecture…', 1),
  ('Compétition', 'competition', '🏁', 'Inscriptions, règlements, logistique et retours d''expérience', 2),
  ('Communication', 'communication', '📣', 'Réseaux sociaux, charte graphique, plaquette sponsors…', 3),
  ('Technique', 'technique', '🔧', 'Process de conception, fabrication, logiciel et tests', 4),
  ('Trésorerie', 'tresorerie', '💰', 'Budget, notes de frais, factures et subventions', 5)
) AS v(name, slug, emoji, description, position)
WHERE NOT EXISTS (SELECT 1 FROM wiki_categories);

CREATE TABLE IF NOT EXISTS wiki_pages (
  id          SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES wiki_categories(id) ON DELETE RESTRICT,
  title       VARCHAR(200) NOT NULL,
  slug        VARCHAR(100) NOT NULL UNIQUE,
  content     TEXT NOT NULL DEFAULT '',
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wiki_pages_category_idx ON wiki_pages (category_id);

CREATE TABLE IF NOT EXISTS wiki_revisions (
  id          SERIAL PRIMARY KEY,
  page_id     INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  category_id INTEGER,
  title       VARCHAR(200) NOT NULL,
  content     TEXT NOT NULL,
  edited_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wiki_revisions_page_idx ON wiki_revisions (page_id, created_at DESC);

-- Kanban des tâches de l'asso (remplace le Kanban Notion) : tous les membres validés
CREATE TABLE IF NOT EXISTS task_poles (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(40) NOT NULL,
  color      VARCHAR(7) NOT NULL DEFAULT '#99aab5',
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS task_poles_name_lower_idx ON task_poles (LOWER(name));
-- Pôles de départ, créés une seule fois (le bureau peut ensuite les modifier)
INSERT INTO task_poles (name, color, position)
SELECT * FROM (VALUES
  ('Bureau', '#ad1457', 1), ('Technique', '#1f8b4c', 2), ('Partenariats', '#c27c0e', 3),
  ('Communication', '#206694', 4), ('Événementiel', '#71368a', 5), ('Compétition', '#992d22', 6),
  ('Trésorerie', '#11806a', 7), ('RSI', '#546e7a', 8), ('Lyon', '#a84300', 9)
) AS v(name, color, position)
WHERE NOT EXISTS (SELECT 1 FROM task_poles);

CREATE TABLE IF NOT EXISTS tasks (
  id           SERIAL PRIMARY KEY,
  title        VARCHAR(300) NOT NULL,
  context      TEXT,
  status       VARCHAR(10) NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  priority     VARCHAR(10) NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  pole_id      INTEGER REFERENCES task_poles(id) ON DELETE SET NULL,
  due_date     DATE,
  position     DOUBLE PRECISION NOT NULL DEFAULT 0,  -- ordre dans la colonne (glisser-déposer)
  completed_at TIMESTAMPTZ,
  notion_id    VARCHAR(64) UNIQUE,                   -- carte d'origine, pour un import sans doublon
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status, position);

-- Responsables : un membre de l'ERP, ou un nom saisi à la main (personne sans compte)
CREATE TABLE IF NOT EXISTS task_assignees (
  id       SERIAL PRIMARY KEY,
  task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name     VARCHAR(200),
  position INTEGER NOT NULL DEFAULT 0,
  CHECK ((user_id IS NULL) <> (name IS NULL))
);
CREATE INDEX IF NOT EXISTS task_assignees_task_idx ON task_assignees (task_id);
CREATE INDEX IF NOT EXISTS task_assignees_user_idx ON task_assignees (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS task_assignees_user_unique ON task_assignees (task_id, user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS task_comments (
  id          SERIAL PRIMARY KEY,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_name VARCHAR(200),  -- auteur d'origine quand il n'a pas de compte (import Notion)
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS task_comments_task_idx ON task_comments (task_id, created_at);

-- Notifications par mail : préférence de chaque membre, et journal des envois (un par personne, type et jour)
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_task_reminders BOOLEAN NOT NULL DEFAULT TRUE;
CREATE TABLE IF NOT EXISTS notification_log (
  id       SERIAL PRIMARY KEY,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind     VARCHAR(40) NOT NULL,
  sent_on  DATE NOT NULL,
  sent_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, kind, sent_on)
);
`;

// Idempotente : exécutée au démarrage de l'API, et via `npm run migrate`
async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(SQL);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { runMigrations };

if (require.main === module) {
  runMigrations()
    .then(() => console.log('✅ Migration terminée'))
    .catch((err) => {
      console.error('❌ Échec de la migration', err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
