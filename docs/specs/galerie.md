# Module Galerie — ERP ARECE

> Spec à donner à Claude Code. À placer dans le repo (ex. `docs/specs/galerie.md`) puis : « Lis docs/specs/galerie.md et suis-le. »

## 0. Avant de coder

1. Explore le repo et résume-moi en quelques lignes : structure backend (Express), système de migrations, middleware d'auth et de permissions, organisation du frontend React (routing, navigation, styles), docker-compose, et serveur MCP s'il est dans ce repo.
2. **Point critique à vérifier : comment l'auth est transmise au backend.** Cookie de session ou header `Authorization: Bearer` ? Une balise `<img src>` n'envoie pas de header, donc si c'est du Bearer, les images devront passer par des URLs signées (voir §5).
3. Propose-moi un plan d'implémentation (fichiers créés/modifiés, ordre des étapes) et **attends ma validation** avant d'écrire du code.
4. Respecte strictement les conventions existantes (nommage, structure des routes, style des migrations, composants UI). Pas de nouvelle dépendance lourde sans me le dire.
5. Travaille sur une branche `feat/galerie`, commits petits et explicites.

## 1. Objectif et périmètre

Ajouter une page **Galerie** à l'ERP : les photos de l'asso sont stockées dans un **Drive partagé Google dédié**, l'ERP les indexe et les affiche aux membres connectés, selon leurs permissions ERP. Les membres n'ont pas besoin d'accès au Drive.

**V1 (ce ticket), lecture seule :**
- Synchronisation Drive → PostgreSQL (initiale + incrémentale)
- Miniatures générées et mises en cache sur le serveur
- Page liste des albums + page album (grille) + visionneuse plein écran + téléchargement de l'original
- Déclenchement manuel de la synchro et statut, réservés au Bureau

**Hors périmètre V1, mais le code doit le permettre sans refonte :**
- Upload depuis l'ERP
- Tags (compétitions existantes, membres présents, partenaires dont le logo est visible)
- Drapeau « utilisable en communication externe » (droit à l'image)
- Vidéos (ignorées en V1, juste comptées dans les logs)
- Outil MCP `galerie_chercher` → mets toute la logique dans une couche service (`galleryService`) réutilisable, pas dans les routes.

## 2. Configuration Google (faite à la main par Gabriel, à documenter dans le README)

- API Google Drive activée sur le projet GCP.
- Un compte de service, ajouté comme **Lecteur** du Drive partagé « ARECE – Photos ».
- Authentification via `google-auth-library` en **Application Default Credentials** :
  - sur la VM GCE : compte de service attaché à la VM, pas de fichier de clé ;
  - ailleurs (dev local, futur hébergeur) : `GOOGLE_APPLICATION_CREDENTIALS` pointant vers une clé JSON **montée en volume en lecture seule, jamais commitée** (ajoute le chemin au `.gitignore`).
- Variables d'environnement (à ajouter au `.env.example`) :
  - `GALLERY_SHARED_DRIVE_ID`
  - `GALLERY_SYNC_INTERVAL_MINUTES` (défaut 10)
  - `GALLERY_THUMBS_DIR` (défaut `/data/gallery/thumbs`)
  - `GALLERY_URL_SIGNING_SECRET` (si URLs signées)

## 3. Modèle de données (nouvelle migration)

**`gallery_albums`**
- `id`, `drive_folder_id` (unique), `name`, `parent_id` (FK nullable → sous-dossiers = sous-albums)
- `cover_photo_id` (FK nullable), `photo_count`, `first_taken_at`, `last_taken_at`
- `is_deleted` (bool), `created_at`, `updated_at`

**`gallery_photos`**
- `id`, `drive_file_id` (unique), `album_id` (FK), `filename`, `mime_type`, `size_bytes`, `md5_checksum`
- `width`, `height`, `taken_at` (EXIF via `imageMediaMetadata.time`, sinon `createdTime`)
- `drive_created_at`, `drive_modified_at`
- `thumb_status` (`pending` | `ok` | `error`), `thumb_error`, `thumbs_generated_for_md5`
- `is_deleted` (bool), `created_at`, `updated_at`
- Index : `(album_id, taken_at DESC, id DESC)` pour la pagination

**`gallery_sync_state`** (une seule ligne)
- `start_page_token`, `last_full_sync_at`, `last_incremental_sync_at`, `last_error`, `last_error_at`, `stats` (jsonb)

Soft delete partout : on ne supprime jamais une ligne quand un fichier disparaît du Drive, on passe `is_deleted = true` (les futurs tags ne doivent pas être perdus si une photo est déplacée).

## 4. Synchronisation (worker)

- **Service séparé dans docker-compose** (`gallery-worker`), même image que le backend, autre commande. Il ne doit pas bloquer l'API.
- **Synchro complète** (premier lancement, ou si `start_page_token` est absent/invalide) :
  - `files.list` avec `corpora=drive`, `driveId`, `includeItemsFromAllDrives=true`, `supportsAllDrives=true`, `q="trashed=false"`, `pageSize=1000`, et `fields` limité au nécessaire (`id,name,mimeType,parents,size,md5Checksum,createdTime,modifiedTime,imageMediaMetadata(width,height,time)`).
  - Dossiers (`application/vnd.google-apps.folder`) → albums ; le dossier parent direct d'une image → son album. Fichiers à la racine du Drive → album « Non classé ».
  - Récupère `changes.getStartPageToken` (avec `driveId` + `supportsAllDrives`) **avant** le listing, pour ne rien rater pendant la synchro.
- **Synchro incrémentale** toutes les `GALLERY_SYNC_INTERVAL_MINUTES` : `changes.list` (mêmes paramètres Drive partagé), gère créations, renommages, déplacements de dossier, mises à la corbeille et suppressions.
- Types acceptés : `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`. Le reste est ignoré (compté dans `stats`).
- Après chaque passe : recalcul de `photo_count`, des dates et de la couverture des albums touchés (couverture = première photo par date si aucune n'est choisie).
- Robustesse : backoff exponentiel sur 403 (rate limit) / 429 / 5xx ; un fichier en erreur ne bloque pas la synchro ; erreurs dans `gallery_sync_state` et dans les logs.
- Verrou (advisory lock PostgreSQL) pour empêcher deux synchros simultanées, y compris si le Bureau la déclenche à la main.

## 5. Miniatures et accès aux fichiers

- Le worker télécharge l'original (`files.get` `alt=media`, `supportsAllDrives=true`) et génère avec `sharp` :
  - `sm` : 400 px de large, WebP qualité ~75 (grille)
  - `lg` : 1600 px de large, WebP qualité ~82 (visionneuse)
- Applique la rotation EXIF (`.rotate()`) et **supprime toutes les métadonnées des miniatures (notamment la géolocalisation GPS)**.
- HEIC/HEIF : les binaires précompilés de `sharp` ne les décodent généralement pas. Teste, et si besoin passe par `heic-convert` en repli. Signale-moi le choix retenu.
- Stockage : volume Docker `${GALLERY_THUMBS_DIR}/{drive_file_id}_{sm|lg}.webp`. Régénère si `md5_checksum` a changé.
- Concurrence limitée (2 à 3 en parallèle) : la VM a 4 Go de RAM.
- **Accès protégé** : les miniatures et les originaux ne sont jamais publics. Selon ce que tu as trouvé au §0 :
  - auth par cookie → routes protégées classiques ;
  - auth par Bearer → l'API renvoie pour chaque photo des URLs signées HMAC (`GALLERY_URL_SIGNING_SECRET`, expiration ~1 h) vérifiées par les routes d'images.
- Cache HTTP des miniatures : `Cache-Control: private, max-age=86400`.

## 6. API (préfixe des routes existantes, ex. `/api/gallery`)

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/albums` | Albums non supprimés, couverture, nombre de photos, dates ; tri par `last_taken_at` desc ; sous-albums imbriqués ou `parent_id` |
| GET | `/albums/:id` | Détail d'un album + sous-albums |
| GET | `/albums/:id/photos?cursor=&limit=60` | Pagination par curseur sur `(taken_at, id)`, pas d'OFFSET |
| GET | `/photos/:id/thumb?size=sm\|lg` | Sert la miniature depuis le volume |
| GET | `/photos/:id/original` | Stream depuis le Drive, `Content-Disposition: attachment`, rate-limité |
| POST | `/sync` | Bureau uniquement — déclenche une synchro incrémentale |
| GET | `/sync/status` | Bureau uniquement — état de la dernière synchro et stats |

**Permissions** (réutilise le middleware existant, ne réimplémente rien) :
- Voir la galerie : Bureau, Actif L1/L2, Alumni L1/L2
- Prospect : aucun accès
- Synchro + lien vers le dossier Drive : Bureau
- Centralise ces règles dans un seul endroit, avec les autres règles de l'ERP, pour pouvoir les changer facilement.
- Écris des tests de permission pour chaque route (accès autorisé / refusé par niveau).

## 7. Frontend

- Nouvelle entrée **Galerie** dans la navigation, route `/galerie`, visible seulement pour les rôles autorisés.
- **`/galerie`** : grille d'albums (couverture, nom, nombre de photos, période). Squelettes de chargement, état vide (« Aucun album, dépose des photos dans le Drive partagé »).
- **`/galerie/:albumId`** : fil d'Ariane, sous-albums en haut, grille responsive des photos (CSS grid), `loading="lazy"`, défilement infini via `IntersectionObserver`.
- **Visionneuse** : plein écran, flèches clavier, Échap, swipe sur mobile, compteur « 12 / 148 », bouton Télécharger l'original, préchargement de l'image suivante. L'URL reflète la photo ouverte (`?photo=ID`) pour pouvoir partager le lien en interne.
- Bureau uniquement : bouton « Synchroniser » + date de la dernière synchro, et lien « Ouvrir dans le Drive ».
- Mobile d'abord : beaucoup de membres consulteront depuis leur téléphone.
- Réutilise les composants et le style existants.

## 8. Déploiement et doc

- `docker-compose.yml` : service `gallery-worker` + volume nommé pour les miniatures (et montage de la clé si hors GCE).
- `.env.example` mis à jour.
- README / doc de déploiement : section « Galerie » avec la mise en place Google (§2) pas à pas, pour que le co-mainteneur puisse refaire la config sans moi.
- Commande pour lancer une synchro complète à la main (`npm run gallery:full-sync` ou équivalent).

## 9. Tests et critères de validation

- Tests unitaires du mapping Drive → BDD avec des réponses de l'API Drive mockées : création, déplacement entre dossiers, renommage, mise à la corbeille, fichier non-image ignoré.
- Tests de permissions des routes (§6).
- Checklist manuelle à me fournir à la fin :
  - [ ] 3 dossiers / ~50 photos dans le Drive → apparaissent après synchro complète
  - [ ] Ajout d'une photo → visible après la synchro incrémentale suivante
  - [ ] Photo mise à la corbeille → disparaît de l'ERP
  - [ ] Photo iPhone HEIC et photo portrait → miniature correcte et bien orientée
  - [ ] Miniature sans GPS (vérifier avec `exiftool`)
  - [ ] Compte Prospect → aucun accès, y compris aux URLs d'images directes
  - [ ] Utilisation sur mobile (grille + swipe dans la visionneuse)

## 10. À la fin

Fais-moi un récap : ce qui a été fait, les choix techniques que tu as faits seul (HEIC, URLs signées ou cookie…), ce qui reste à faire à la main côté Google Cloud, et les points à surveiller pour la V2 (tags, upload, MCP).
