# Périclès
Périclès : l'outil interne des membres de l'association ARECE (anciennement « ERP ARECE »).

## Périclès — annuaire, tâches, wiki, galerie et sponsoring

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

### Relance des tâches en retard (mail)

Chaque matin à partir de 8 h (heure de Paris, `TASK_REMINDER_HOUR`), chaque responsable inscrit reçoit **un seul
mail récapitulatif** de ses tâches encore dans « À faire » dont l'échéance est passée, tant qu'elles le restent.
Les responsables sans compte Périclès ne reçoivent rien. Chacun peut désactiver la relance dans *Informations de connexion
→ Notifications par mail*. Un envoi par personne et par jour au maximum (table `notification_log`), même après un
redémarrage. Nécessite l'envoi de mails (ci-dessous) ; `TASK_REMINDERS=off` dans `.env` coupe tout.
Aperçu sans envoi : `docker compose -f docker-compose.prod.yml exec backend node src/scripts/task-reminders.js`
(`--envoyer` pour envoyer tout de suite les relances du jour).

**Récap du lundi** (même heure) : chaque membre actif ayant des tâches « À faire » ou « En cours » reçoit la liste
de ses tâches ; les membres actifs du bureau reçoivent en plus toutes les tâches ouvertes, par responsable (et
celles sans responsable). Aucun mail aux membres sans tâche (hors bureau), aux alumni, membres d'honneur ni comptes
non validés (ces exclusions valent aussi pour la relance quotidienne). Désactivable au même endroit. Aperçu :
`node src/scripts/task-reminders.js --recap` (`--recap --envoyer` pour l'envoyer tout de suite).

**Assignation** : quand un membre (ou son assistant IA) ajoute quelqu'un comme responsable d'une tâche, à la
création ou en modification, le nouveau responsable reçoit aussitôt un mail avec la tâche et un lien qui l'ouvre
(`/taches?tache=<id>`). Pas de mail si on s'assigne soi-même, pour une tâche déjà faite, ni aux alumni, membres
d'honneur et comptes non validés. Désactivable au même endroit.

### Mot de passe oublié (envoi de mails)

« Mot de passe oublié ? » sur la page de connexion envoie un lien de réinitialisation **à usage unique,
valable 1 heure** (jeton stocké haché). La réponse est la même que le compte existe ou non ; limites :
3 mails par compte et par heure, 10 demandes par IP et par heure. Le nouveau mot de passe ferme
toutes les sessions ouvertes et connecte l'utilisateur. Le lien reste masqué tant que l'envoi n'est pas configuré.

Configuration (`.env`) : `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `MAIL_FROM_NAME`.
- **Relais SMTP Google Workspace** (recommandé, sans mot de passe) : console d'admin → Applications →
  Google Workspace → Gmail → Routage → *Service de relais SMTP* : expéditeurs « uniquement les adresses de
  mes domaines », authentification « uniquement les adresses IP spécifiées » (IP du serveur), TLS obligatoire.
  Puis `SMTP_HOST=smtp-relay.gmail.com`, `SMTP_PORT=587`, `SMTP_USER`/`SMTP_PASS` vides.
- **Compte + mot de passe d'application** : `SMTP_HOST=smtp.gmail.com`, `SMTP_USER=erp@arece.eu`,
  `SMTP_PASS=<mot de passe d'application>` (validation en deux étapes requise sur ce compte).

Délivrabilité : publier les enregistrements DNS SPF (`v=spf1 include:_spf.google.com ~all`), DKIM
(console d'admin → Gmail → Authentifier les e-mails) et DMARC. Tester l'envoi :
`docker compose -f docker-compose.prod.yml exec backend node src/scripts/test-mail.js toi@exemple.fr`

### Assistants IA (serveur MCP)

`<PUBLIC_URL>/mcp` est un serveur MCP distant (Streamable HTTP, sans session) utilisable depuis Claude
(connecteur personnalisé), ChatGPT (connecteur en mode développeur), Gemini CLI / Antigravity, Claude Code…
- **Connexion** : OAuth 2.1 avec enregistrement dynamique des clients et PKCE (routes standard `/authorize`,
  `/token`, `/register`, `/revoke`, `/.well-known/oauth-*` fournies par le SDK MCP officiel). L'étape d'accord se
  fait dans Périclès (`/autoriser-assistant`) par le membre connecté. Jetons d'accès 1 h, renouvellement 30 jours
  (rotation), tous stockés hachés. Pour les outils sans OAuth : **jetons personnels** (1 an) créés dans
  *Informations de connexion → Assistants IA*, où l'on peut aussi déconnecter un assistant.
- **Droits** : l'assistant agit avec les droits du membre. Les jetons d'assistant ne sont acceptés que sur
  `/api/tasks`, `/api/wiki`, `/api/sponsoring` et `/api/auth/me`, et jamais pour une suppression.
- **Outils** : `erp_reference`, `taches_lister`, `tache_details`, `tache_creer`, `tache_modifier`, `tache_commenter`,
  `wiki_chercher`, `wiki_lire`, `wiki_creer_page`, `wiki_modifier_page` (remplacements ciblés, ajout en fin ou
  contenu complet, protégé contre l'écrasement d'une modification concurrente), `wiki_historique`,
  et pour le bureau / tag Sponsoring : `partenaires_lister`, `partenaire_details`, `partenaire_creer`,
  `partenaire_modifier`, `partenaire_ajouter_contact`, `partenaire_ajouter_contrepartie`, `contrepartie_marquer`.
  Ils appellent l'API de Périclès : mêmes validations que l'interface.

### Wiki

Page **Wiki** pour tous les membres validés : des pages en **Markdown** (avec diagrammes **Mermaid** dans des blocs
```` ```mermaid ````, chargés seulement quand une page en contient) rangées par catégorie
(Administratif, Compétition, Communication, Technique, Trésorerie au départ ; le bureau peut en
ajouter, renommer ou supprimer une catégorie vide). Chacun peut créer et modifier les pages ; chaque
enregistrement garde une **version** consultable et restaurable dans l'historique. Si quelqu'un a
modifié la page pendant qu'on l'éditait, l'enregistrement est refusé au lieu d'écraser son travail.
Suppression d'une page : son auteur ou le bureau. Recherche dans les titres et le contenu.
Chaque titre a une **ancre** comme sur Wikipedia (« ## Règlement FSUK » → `#reglement-fsuk`, lien copiable via le
« # » au survol), utilisable dans les liens (`[voir](#reglement-fsuk)`, `[budget](/wiki/p/tresorerie#budget)`) et
dans une adresse partagée ; sommaire automatique en haut des pages d'au moins 3 titres.

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

### Galerie photos

Page **Galerie** (`/galerie`) : les photos de l'asso, stockées dans le **Drive partagé « ARECE – Photos »**, indexées
par Périclès et affichées aux membres connectés selon leurs droits (tableau des permissions ci-dessous). Les membres
n'ont pas besoin d'accès au Drive. Lecture seule pour l'instant : on ajoute, range et supprime les photos **dans le Drive**.

- Chaque dossier du Drive est un album, chaque sous-dossier un sous-album ; les photos posées à la racine du Drive
  vont dans l'album « Non classé ». Albums vides masqués. Types pris en charge : JPEG, PNG, WebP, HEIC/HEIF (iPhone).
  Vidéos et autres fichiers ignorés (comptés dans l'état de synchro).
- Le service **`gallery-worker`** (même image que l'API) synchronise le Drive toutes les
  `GALLERY_SYNC_INTERVAL_MINUTES` (10 min) : renommages, déplacements, mises à la corbeille (album ou photo masqués,
  restaurés s'ils sortent de la corbeille) et suppressions. Rien n'est effacé en base (`is_deleted`).
- Il prépare deux miniatures WebP par photo (400 px pour la grille, 1600 px pour la visionneuse), redressées selon
  l'EXIF et **sans aucune métadonnée (pas de GPS)**, dans le volume Docker `gallery_thumbs`. HEIC : converti par
  `heic-convert` (les binaires de `sharp` ne lisent pas le HEVC). L'**original** téléchargé depuis la visionneuse
  vient tel quel du Drive, avec ses métadonnées d'origine.
- Images servies par des **liens signés** (HMAC, valables 1 à 2 h, propres à chaque membre) : Périclès s'authentifie
  par un en-tête que les balises `<img>` n'envoient pas. Chaque image revérifie les droits du membre (un compte
  repassé prospect perd l'accès en une minute au plus).
- Bureau : bouton **Synchroniser**, date et erreurs de la dernière synchro, liens « Ouvrir dans le Drive ».

#### Mise en place côté Google (une fois)

1. **Drive partagé** : sur drive.google.com avec un compte @arece.eu → *Drives partagés* → *Nouveau* →
   « ARECE – Photos ». L'ID est la fin de son adresse : `https://drive.google.com/drive/folders/<ID>`.
2. **Partage externe** : le compte de service a une adresse hors du domaine arece.eu.
   - Console d'admin Google (admin.google.com) → *Applications* → *Google Workspace* → *Drive et Docs* →
     *Paramètres de partage* : le partage hors d'ARECE doit être autorisé (éventuellement limité à une liste
     d'autorisation), ainsi que l'accès des personnes externes aux fichiers des Drives partagés.
   - Dans le Drive partagé : roue crantée → *Paramètres du Drive partagé* → autoriser les personnes externes à ARECE.
3. **API Drive** : console.cloud.google.com, projet `aop-arece-test` → *API et services* → *Bibliothèque* →
   « Google Drive API » → *Activer*.
4. **Compte de service** : *IAM et administration* → *Comptes de service* → *Créer* : nom `erp-galerie`,
   **aucun rôle** sur le projet. Noter son adresse (`erp-galerie@aop-arece-test.iam.gserviceaccount.com`).
5. **Clé JSON** : sur ce compte → onglet *Clés* → *Ajouter une clé* → *Créer une clé* → JSON (fichier téléchargé).
   Si Google refuse (« la création de clés de compte de service est désactivée ») : *IAM et administration* →
   *Règles d'administration* → `iam.disableServiceAccountKeyCreation` → *Gérer la règle* → remplacer la règle
   parente pour ce projet par *Non appliquée* (rôle « Administrateur des règles d'administration » au niveau de
   l'organisation requis), créer la clé, puis remettre la règle.
6. **Accès au Drive** : Drive partagé → *Gérer les membres* → ajouter l'adresse du compte de service, rôle
   **Lecteur**, sans notification.
7. **Serveur** (la clé ne passe jamais par git ni par une messagerie) :
   ```bash
   scp galerie-drive.json arece@<serveur>:~/arece/secrets/galerie-drive.json
   ssh arece@<serveur> 'chmod 700 ~/arece/secrets && chmod 600 ~/arece/secrets/galerie-drive.json'
   # dans ~/arece/.env : GALLERY_SHARED_DRIVE_ID=<ID de l'étape 1>
   cd ~/arece && docker compose -f docker-compose.prod.yml --env-file .env up -d
   docker compose -f docker-compose.prod.yml logs -f gallery-worker   # première synchro complète
   ```
   Le fichier doit s'appeler `galerie-drive.json` (variable `GOOGLE_APPLICATION_CREDENTIALS` du compose).
   Changer de clé : en créer une nouvelle, remplacer le fichier, `docker compose … restart backend gallery-worker`,
   puis supprimer l'ancienne dans la console. Sur une machine Google Cloud avec un compte de service attaché,
   aucune clé n'est nécessaire (retirer alors `GOOGLE_APPLICATION_CREDENTIALS`).

#### Commandes utiles

```bash
# Synchro complète à la main (relit tout le Drive ; les miniatures suivent dans le worker)
docker compose -f docker-compose.prod.yml --env-file .env exec gallery-worker npm run gallery:full-sync
# Refaire toutes les miniatures (ex : après un changement de taille)
docker compose -f docker-compose.prod.yml exec postgres psql -U arece -d arece_db -c "UPDATE gallery_photos SET thumb_status='pending', thumb_attempts=0"
# Tests (mapping Drive → base, permissions des routes, liens signés, miniatures)
docker compose -f docker-compose.prod.yml exec backend npm test
```

La synchro sur une vraie base se teste avec une base dédiée (son nom doit finir par `_test`, elle est vidée) :
`TEST_DATABASE_URL=postgresql://arece:<mdp>@postgres:5432/arece_gallery_test npm test`.
Les tables `gallery_*` sont dans les sauvegardes de la base ; les miniatures non (recalculables depuis le Drive).

### Permissions (rôles d'accès)

| Rôle d'accès     | Annuaire visible                         | Ask ARECE | Galerie |
|------------------|------------------------------------------|-----------|---------|
| Bureau           | Tout (y compris prospects)               | Complet   | Oui + synchro et liens Drive |
| Actif L1         | Bureau + actifs de l'année               | Limité    | Oui     |
| Actif L2         | Tout                                     | Limité    | Oui     |
| Alumni L1        | Lui-même + alumni                        | Aucun     | Oui     |
| Alumni L2        | Tout                                     | Limité    | Oui     |
| Honoraire L1/L2  | Lui-même / tout *(non spécifié, à valider)* | Aucun / Limité | Non / Oui |
| Prospect         | Aucun                                    | Aucun     | Non     |

Ces règles sont des fonctions de `backend/src/auth.js` (`canViewUser`, `getAskAreceAccess`, `canViewGallery`,
`canManageGallery`) ; `/api/auth/me` les transmet au frontend dans `permissions`.

« Limité » = sans le dossier `bureau` du Drive. L'année académique va du 1er septembre
au 31 août ; un « actif de l'année » est un membre au statut `active` (le bureau passe
les sortants en `alumni` à chaque rentrée).

### API

| Méthode | Route                         | Auth |
|---------|-------------------------------|------|
| GET     | `/api/auth/config`            | — (SSO Google, mot de passe oublié activés ?) |
| POST    | `/api/auth/signup`            | — (mail perso ; LinkedIn et promo facultatifs) |
| POST    | `/api/auth/login`             | — (refusé pour @arece.eu / @edu.ece.fr) |
| GET     | `/api/auth/me`                | ✔    |
| PUT     | `/api/auth/email` `{ email, currentPassword }` | ✔ |
| PUT     | `/api/auth/password` `{ currentPassword, newPassword }` | ✔ (déconnecte les autres sessions) |
| POST    | `/api/auth/logout`            | ✔    |
| POST    | `/api/auth/forgot-password` `{ email }` | — (mail de réinitialisation, réponse identique dans tous les cas) |
| GET     | `/api/auth/reset-password?token=` | — (lien encore valable ?) |
| POST    | `/api/auth/reset-password` `{ token, password }` | — (nouveau mot de passe, renvoie une session) |
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
| GET     | `/api/gallery/albums`         | ✔ galerie (albums visibles, à plat avec `parentId`) |
| GET     | `/api/gallery/albums/:id`     | ✔ galerie (album, fil d'Ariane, sous-albums) |
| GET     | `/api/gallery/albums/:id/photos?cursor=&limit=60` | ✔ galerie (par curseur, plus récentes d'abord) |
| GET     | `/api/gallery/photos/:id`     | ✔ galerie (photo, liens frais, place dans l'album) |
| GET     | `/api/gallery/photos/:id/thumb?size=sm\|lg&exp&u&sig` | lien signé (miniature WebP) |
| GET     | `/api/gallery/photos/:id/original?exp&u&sig` | lien signé (original depuis le Drive, limité en débit) |
| POST    | `/api/gallery/sync`           | ✔ bureau (synchro immédiate par le worker) |
| GET     | `/api/gallery/sync/status`    | ✔ bureau |

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
