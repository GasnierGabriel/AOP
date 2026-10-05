# AOP
test d'une interface pour la gestion d'ARECE

## ERP ARECE — Annuaire des membres

Stack : Node/Express + React + PostgreSQL, via Docker Compose.

### Lancer

```bash
docker-compose up -d
docker-compose exec backend npm run migrate
```

- Frontend : http://localhost:3001
- Backend : http://localhost:3000 (santé : `/api/health`)
- DB : localhost:5432

### Premier membre du bureau

Toute inscription crée un compte `prospect` (aucun accès). Il n'y a pas encore d'écran
d'administration : pour promouvoir le premier compte bureau, crée ton compte via
`/signup`, puis :

```bash
docker-compose exec postgres psql -U arece -d arece_db -c "UPDATE users SET status='active', is_bureau=true, level=2, updated_at=NOW() WHERE email='ton.email@exemple.fr';"
```

Même principe pour valider un prospect (`status='active'`, `level=1|2`).

### Permissions (rôles d'accès)

| Rôle d'accès     | Annuaire visible                         | Ask ARECE |
|------------------|------------------------------------------|-----------|
| Bureau           | Tout (y compris prospects)               | Complet   |
| Actif L1         | Bureau + actifs de l'année               | Limité    |
| Actif L2         | Tout                                     | Limité    |
| Alumni L1        | Lui-même + alumni                        | Aucun     |
| Alumni L2        | Tout                                     | Limité    |
| Honoraire L1/L2  | Lui-même / tout *(non spécifié, à valider)* | Aucun / Limité |
| Prospect         | Aucun                                    | Aucun     |

« Limité » = sans le dossier `bureau` du Drive. L'année académique va du 1er septembre
au 31 août ; un « actif de l'année » est un membre au statut `active` (le bureau passe
les sortants en `alumni` à chaque rentrée).

### API

| Méthode | Route                         | Auth |
|---------|-------------------------------|------|
| POST    | `/api/auth/signup`            | —    |
| POST    | `/api/auth/login`             | —    |
| GET     | `/api/auth/me`                | ✔    |
| POST    | `/api/auth/logout`            | ✔    |
| GET     | `/api/annuaire/members`       | ✔ membre |
| GET     | `/api/annuaire/members/:id`   | ✔ membre |
| PUT     | `/api/annuaire/profile`       | ✔    |
| GET     | `/api/annuaire/tags`          | ✔ bureau |
| POST    | `/api/annuaire/tags` `{ name, color, emoji }` | ✔ bureau |
| PATCH   | `/api/annuaire/tags/:id` `{ name?, color?, emoji? }` | ✔ bureau |
| DELETE  | `/api/annuaire/tags/:id`      | ✔ bureau (retire le tag de tout le monde) |
| POST    | `/api/annuaire/members/:id/tags` `{ tagId }` | ✔ bureau |
| DELETE  | `/api/annuaire/members/:id/tags/:tagId`      | ✔ bureau |

### Tags

Inspirés des rôles Discord : une pastille avec un point de couleur, une puce emoji optionnelle
et un nom. Sur la fiche d'un membre, le bureau clique sur **+** pour ajouter / retirer un tag,
le créer (couleur de la palette Discord ou personnalisée, emoji) ou le modifier (✎). Survoler
le point coloré d'une pastille le transforme en × pour retirer le tag. La casse est ignorée
(`cao` = `CAO`). Les tags sont visibles par tous ceux qui voient le profil, et filtrables dans
l'annuaire.
