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

Production : **https://erp.arece.eu** (`docker-compose.prod.yml`). Caddy obtient et renouvelle
seul le certificat Let's Encrypt dès que `SITE_ADDRESS` est un nom de domaine pointant vers le
serveur ; `REDIRECT_FROM=http://<ip>` redirige l'ancienne adresse vers `PUBLIC_URL`.

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

### Connexion

L'identifiant est un **mail perso** : les adresses `@arece.eu` et `@edu.ece.fr` sont refusées à
l'inscription et à la connexion par mot de passe (liste modifiable via `BLOCKED_EMAIL_DOMAINS`).
Depuis **Informations de connexion** (clic sur son nom, ou depuis Mon profil), chacun peut changer
son mail perso, son mot de passe, et **lier son compte Google Workspace @arece.eu** pour se connecter
ensuite en un clic (« Se connecter avec Google » sur la page de connexion).

Activer le SSO Google :
1. Console GCP du Workspace → API et services → Écran de consentement OAuth : type **Interne**.
2. Identifiants → Créer un ID client OAuth → **Application Web**, URI de redirection autorisée :
   `<PUBLIC_URL>/api/auth/google/callback`. Google exige un **nom de domaine en HTTPS**
   (une adresse IP est refusée ; `http://localhost` est accepté pour les tests).
3. Renseigner `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` dans `.env`, puis redémarrer le backend.
   Le bouton Google reste masqué tant qu'ils sont vides.

### Wiki

Page **Wiki** pour tous les membres validés : des pages en **Markdown** rangées par catégorie
(Administratif, Compétition, Communication, Technique, Trésorerie au départ ; le bureau peut en
ajouter, renommer ou supprimer une catégorie vide). Chacun peut créer et modifier les pages ; chaque
enregistrement garde une **version** consultable et restaurable dans l'historique. Si quelqu'un a
modifié la page pendant qu'on l'éditait, l'enregistrement est refusé au lieu d'écraser son travail.
Suppression d'une page : son auteur ou le bureau. Recherche dans les titres et le contenu.

API : `GET /api/wiki/categories`, `POST` / `PATCH` / `DELETE /api/wiki/categories/:id` (bureau),
`GET /api/wiki/pages?categorie=&q=&tri=`, `GET` / `PUT` / `DELETE /api/wiki/pages/:slug`,
`POST /api/wiki/pages`, `GET /api/wiki/pages/:slug/revisions[/:id]`.

### Sponsoring

Page **Sponsoring**, réservée au bureau et aux membres portant le tag **« Sponsoring »** (à créer
et attribuer depuis la fiche d'un membre). Suivi des partenaires : statut dans le pipeline
(à contacter → contacté → en négociation → signé / refusé), type d'apport (argent, matériel,
service, mixte) et montant ou valeur estimée, contact, membre responsable, prochaine relance
(en rouge si dépassée) et notes. Totaux signés / en négociation et relances en retard en tête de page.
Un partenaire **signé doit avoir un rang** : Bronze, Argent, Or, Platine au départ ; l'équipe peut
en créer d'autres (bouton « Rangs », ou « + Nouveau rang… » dans la fiche), les renommer, changer
leur couleur ou supprimer un rang non attribué.

API : `GET /api/sponsoring/sponsors`, `POST /api/sponsoring/sponsors`,
`PATCH` / `DELETE /api/sponsoring/sponsors/:id`, `GET /api/sponsoring/team` (responsables possibles).

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
| GET     | `/api/auth/config`            | — (SSO Google activé ?) |
| POST    | `/api/auth/signup`            | — (mail perso ; LinkedIn et promo facultatifs) |
| POST    | `/api/auth/login`             | — (refusé pour @arece.eu / @edu.ece.fr) |
| GET     | `/api/auth/me`                | ✔    |
| PUT     | `/api/auth/email` `{ email, currentPassword }` | ✔ |
| PUT     | `/api/auth/password` `{ currentPassword, newPassword }` | ✔ (déconnecte les autres sessions) |
| POST    | `/api/auth/logout`            | ✔    |
| POST    | `/api/auth/google/link-ticket` | ✔ (lance la liaison Google) |
| GET     | `/api/auth/google/start?mode=login\|link` | — (redirige vers Google) |
| GET     | `/api/auth/google/callback`   | — (retour de Google) |
| DELETE  | `/api/auth/google`            | ✔ (dissocier) |
| GET     | `/api/annuaire/members`       | ✔ membre |
| GET     | `/api/annuaire/members/:id`   | ✔ membre |
| PUT     | `/api/annuaire/profile`       | ✔    |
| PATCH   | `/api/annuaire/members/:id/access` `{ status?, isBureau?, level?, promo? }` | ✔ bureau |
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
