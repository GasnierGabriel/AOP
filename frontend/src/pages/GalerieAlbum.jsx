import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api, { errorMessage } from '../api';
import PhotoViewer from '../components/PhotoViewer';
import { AlbumCard, albumPeriod, galleryImage } from './Galerie';

const PAGE_SIZE = 60;
const LINKS_TTL_MS = 50 * 60 * 1000; // liens d'images signés : valables au moins 1 h, renouvelés avant

// Album : sous-albums, grille de photos en défilement infini, visionneuse (?photo=ID dans l'adresse)
export default function GalerieAlbum() {
  const { albumId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [info, setInfo] = useState(null); // { album, breadcrumb, subAlbums }
  const [photos, setPhotos] = useState(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const cursor = useRef(null);
  const busy = useRef(false);
  const loadedAt = useRef(0);
  const photosRef = useRef([]);
  const openedHere = useRef(false); // visionneuse ouverte depuis la grille : la fermer = revenir en arrière
  const sentinel = useRef(null);
  photosRef.current = photos || [];

  const loadMore = useCallback(async () => {
    if (busy.current || !cursor.current) return;
    busy.current = true;
    setLoadingMore(true);
    try {
      const { data } = await api.get(`/gallery/albums/${albumId}/photos`, { params: { cursor: cursor.current, limit: PAGE_SIZE } });
      cursor.current = data.nextCursor;
      setHasMore(Boolean(data.nextCursor));
      setTotal(data.total);
      setPhotos((prev) => [...(prev || []), ...data.photos]);
    } catch (err) {
      setError(errorMessage(err, 'Impossible de charger la suite des photos'));
    } finally {
      busy.current = false;
      setLoadingMore(false);
    }
  }, [albumId]);

  // Album et première page de photos ; rechargés à l'identique (même nombre de photos) pour renouveler les liens signés
  const loadAll = useCallback(
    async (keepCount = 0) => {
      busy.current = true;
      try {
        const [{ data: album }, first] = await Promise.all([
          api.get(`/gallery/albums/${albumId}`),
          api.get(`/gallery/albums/${albumId}/photos`, { params: { limit: PAGE_SIZE } }),
        ]);
        let list = first.data.photos;
        let next = first.data.nextCursor;
        while (next && list.length < keepCount) {
          const { data } = await api.get(`/gallery/albums/${albumId}/photos`, { params: { cursor: next, limit: PAGE_SIZE } });
          list = list.concat(data.photos);
          next = data.nextCursor;
        }
        cursor.current = next;
        loadedAt.current = Date.now();
        setInfo(album);
        setTotal(first.data.total);
        setHasMore(Boolean(next));
        setPhotos(list);
        setError('');
      } catch (err) {
        setError(errorMessage(err, err.response?.status === 404 ? 'Album introuvable' : "Impossible de charger l'album"));
      } finally {
        busy.current = false;
      }
    },
    [albumId]
  );

  useEffect(() => {
    setInfo(null);
    setPhotos(null);
    setError('');
    setNotice('');
    cursor.current = null;
    loadAll();
  }, [loadAll]);

  // Page restée ouverte longtemps : liens d'images renouvelés au retour sur l'onglet, ou quand une image ne charge plus
  const refreshLinks = useCallback(() => {
    if (busy.current || Date.now() - loadedAt.current < LINKS_TTL_MS) return;
    loadAll(photosRef.current.length);
  }, [loadAll]);
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && refreshLinks();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshLinks]);

  // Défilement infini : la page suivante se charge à l'approche du bas de la grille
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !hasMore) return undefined;
    const observer = new IntersectionObserver((entries) => entries[0].isIntersecting && loadMore(), { rootMargin: '800px 0px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loadMore, photos]);

  // Titre de l'onglet : nom de l'album
  useEffect(() => {
    if (info?.album.name) document.title = `${info.album.name} · Galerie · ERP ARECE`;
  }, [info?.album.name]);

  // Photo demandée par l'adresse (?photo=ID) : on charge les pages jusqu'à la trouver
  const photoParam = Number(searchParams.get('photo')) || null;
  const viewerIndex = photoParam && photos ? photos.findIndex((p) => p.id === photoParam) : -1;
  useEffect(() => {
    if (!photoParam) {
      openedHere.current = false;
      return;
    }
    if (!photos || viewerIndex !== -1) return;
    if (hasMore) loadMore();
    else if (!busy.current) {
      setNotice('Cette photo n’est plus dans l’album (déplacée ou supprimée du Drive).');
      setSearchParams((prev) => {
        prev.delete('photo');
        return prev;
      }, { replace: true });
    }
  }, [photoParam, photos, viewerIndex, hasMore, loadMore, setSearchParams]);

  const setPhotoParam = (id, replace) =>
    setSearchParams(
      (prev) => {
        if (id) prev.set('photo', String(id));
        else prev.delete('photo');
        return prev;
      },
      { replace }
    );

  // Bureau : couverture choisie pour cet album ou un album parent (null = retour à la couverture automatique)
  const [coverError, setCoverError] = useState('');
  const setCover = async (targetId, photoId) => {
    await api.put(`/gallery/albums/${targetId}/cover`, { photoId });
    const { data } = await api.get(`/gallery/albums/${albumId}`);
    setInfo(data);
  };
  const resetCover = () => {
    setCoverError('');
    setCover(Number(albumId), null).catch((err) => setCoverError(errorMessage(err, 'Impossible de rétablir la couverture automatique')));
  };

  const openPhoto = (index) => {
    openedHere.current = true;
    setNotice('');
    setPhotoParam(photos[index].id, false); // nouvelle entrée d'historique : le bouton retour du téléphone ferme la visionneuse
  };
  const closeViewer = () => {
    if (openedHere.current) navigate(-1);
    else setPhotoParam(null, true);
  };

  if (error && !info) {
    return (
      <div className="card empty-state">
        <h2>{error}</h2>
        <Link to="/galerie">← Retour à la galerie</Link>
      </div>
    );
  }

  const album = info?.album;
  return (
    <div className="gallery">
      <nav className="breadcrumb" aria-label="Fil d'Ariane">
        <Link to="/galerie">Galerie</Link>
        {info?.breadcrumb.map((crumb) => (
          <span key={crumb.id}>
            {' '}
            <span aria-hidden="true">›</span> <Link to={`/galerie/${crumb.id}`}>{crumb.name}</Link>
          </span>
        ))}
      </nav>

      <div className="page-header">
        <div>
          <h1>{album ? album.name : 'Album'}</h1>
          {album && (
            <p className="muted small">
              {album.totalPhotoCount} photo{album.totalPhotoCount > 1 ? 's' : ''}
              {album.firstTakenAt && ` · ${albumPeriod(album.firstTakenAt, album.lastTakenAt)}`}
            </p>
          )}
        </div>
        {album?.driveUrl && (
          <div className="gallery-album-actions">
            {album.coverIsManual && (
              <button type="button" className="btn btn-outline btn-sm" onClick={resetCover} title="La couverture redevient la première photo par date">
                Couverture automatique
              </button>
            )}
            <a href={album.driveUrl} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
              Ouvrir dans le Drive
            </a>
          </div>
        )}
      </div>
      {album?.driveUrl && (
        <p className="muted small gallery-cover-hint">
          {photos?.length === 0 && info?.subAlbums.length > 0
            ? `Bureau : pour changer la couverture, ouvre une photo d’un sous-album, « ★ Couverture », puis « Couverture de « ${album.name} » ».`
            : 'Bureau : pour changer la couverture, ouvre une photo puis « ★ Couverture » (aussi possible depuis un sous-album).'}
        </p>
      )}
      {coverError && <div role="alert" className="alert alert-error">{coverError}</div>}

      {error && <div role="alert" className="alert alert-error">{error}</div>}
      {notice && <div role="status" className="alert alert-info">{notice}</div>}

      {info?.subAlbums.length > 0 && (
        <section aria-labelledby="sous-albums">
          <h2 id="sous-albums" className="gallery-section-title">
            Albums
          </h2>
          <ul className="album-grid">
            {info.subAlbums.map((sub) => (
              <AlbumCard key={sub.id} album={sub} />
            ))}
          </ul>
        </section>
      )}

      {!photos && (
        <>
          <p className="sr-only" role="status">Chargement des photos…</p>
          <ul className="photo-grid" aria-hidden="true">
            {Array.from({ length: 12 }, (_, i) => (
              <li key={i} className="photo-tile skeleton" />
            ))}
          </ul>
        </>
      )}

      {photos?.length > 0 && (
        <section aria-labelledby="photos-album">
          {info?.subAlbums.length > 0 && (
            <h2 id="photos-album" className="gallery-section-title">
              Photos
            </h2>
          )}
          {!info?.subAlbums.length && <h2 id="photos-album" className="sr-only">Photos</h2>}
          <ul className="photo-grid">
            {photos.map((photo, index) => (
              <li key={photo.id}>
                <button type="button" className="photo-tile" onClick={() => openPhoto(index)} aria-label={`Agrandir ${photo.filename}`}>
                  {photo.thumbSm ? (
                    <img src={galleryImage(photo.thumbSm)} alt="" loading="lazy" decoding="async" onError={refreshLinks} />
                  ) : (
                    <span className="photo-tile-pending" title="Miniature en préparation">
                      <span aria-hidden="true">⏳</span>
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <div ref={sentinel} className="photo-grid-end">
            {loadingMore && <span role="status">Chargement…</span>}
          </div>
        </section>
      )}

      {photos?.length === 0 && !info?.subAlbums.length && (
        <div className="card empty-state">
          <h2>Album vide</h2>
          <p className="muted">Les photos ajoutées à ce dossier du Drive apparaîtront ici après la prochaine synchro.</p>
        </div>
      )}

      {viewerIndex !== -1 && (
        <PhotoViewer
          photos={photos}
          index={viewerIndex}
          total={total}
          canManage={Boolean(album?.driveUrl)}
          coverTargets={
            album?.driveUrl
              ? [{ id: album.id, name: album.name, coverId: album.cover?.id }, ...[...info.breadcrumb].reverse()]
              : null
          }
          onSetCover={setCover}
          onIndexChange={(index) => setPhotoParam(photos[index].id, true)}
          onClose={closeViewer}
          onNeedMore={loadMore}
        />
      )}
    </div>
  );
}
