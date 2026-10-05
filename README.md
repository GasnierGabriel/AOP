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

Toute inscription crée un compte `prospect` (aucun accès). Le bureau valide ensuite les
inscriptions et gère statuts, bureau et niveaux depuis la page **Gestion**. Seul le tout
premier compte bureau doit être promu à la main : crée ton compte via `/signup`, puis :

```bash
docker-compose exec postgres psql -U arece -d arece_db -c "UPDATE users SET status='active', is_bureau=true, level=2, updated_at=NOW() WHERE email='ton.email@exemple.fr';"
```

Le niveau d'accès (1/2) est une donnée interne : il n'est visible et modifiable que par le
bureau (l'API ne l'envoie pas aux autres membres). Il est impossible de retirer le dernier
membre du bureau, et un membre du bureau ne peut pas être prospect.

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
| PATCH   | `/api/annuaire/members/:id/access` `{ status?, isBureau?, level? }` | ✔ bureau |
| DELETE  | `/api/annuaire/members/:id`   | ✔ bureau (ni soi-même, ni un membre du bureau) |
| GET     | `/api/annuaire/tags`          | ✔ bureau |
| POST    | `/api/annuaire/tags` `{ name, color, emoji }` | ✔ bureau |
| PATCH   | `/api/annuaire/tags/:id` `{ name?, color?, emoji? }` | ✔ bureau |
| DELETE  | `/api/annuaire/tags/:id`      | ✔ bureau (retire le tag de tout le monde) |
| POST    | `/api/annuaire/members/:id/tags` `{ tagId }` | ✔ bureau |
| DELETE  | `/api/annuaire/members/:id/tags/:tagId`      | ✔ bureau |
| GET     | `/api/annuaire/catalog`       | ✔ (suggestions : rôles, pôles, compétitions) |
| POST    | `/api/annuaire/members/:id/roles` `{ name, pole, startDate, endDate }` | ✔ soi-même ou bureau |
| PATCH / DELETE | `/api/annuaire/members/:id/roles/:entryId` | ✔ soi-même ou bureau |
| POST    | `/api/annuaire/members/:id/competitions` `{ name, year, events[{ name, rank }], result, comment }` | ✔ soi-même ou bureau |
| PATCH / DELETE | `/api/annuaire/members/:id/competitions/:entryId` | ✔ soi-même ou bureau |

### Parcours (rôles et compétitions)

Chaque membre complète son historique de rôles (intitulé, pôle, dates ; sans date de fin =
rôle actuel) et ses compétitions depuis **Mon profil** : Formula Student UK, Formula Student
France, Challenge Awake ou autre, l'année (à part du nom), les épreuves préparées (plusieurs
possibles, chacune avec son classement ; en FSUK : Business Plan Presentation, Autonomous Design
Event, Real World AI, Simulation Design Event) et un commentaire facultatif. Le Challenge Awake
n'a pas d'épreuves : seulement un classement général. Le
bureau peut faire de même depuis la fiche de n'importe quel membre. Un rôle ou une compétition
inconnus sont ajoutés au catalogue commun, proposé en suggestion à la saisie.

### Tags

Inspirés des rôles Discord : une pastille avec un point de couleur, une puce emoji optionnelle
et un nom. Sur la fiche d'un membre, le bureau clique sur **+** pour ajouter / retirer un tag,
le créer (couleur de la palette Discord ou personnalisée, emoji) ou le modifier (✎). Survoler
le point coloré d'une pastille le transforme en × pour retirer le tag. La casse est ignorée
(`cao` = `CAO`). Les tags sont visibles par tous ceux qui voient le profil, et filtrables dans
l'annuaire.
