import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { API_BASE, errorMessage } from '../api';

// Adresse d'une image de la galerie (lien signé renvoyé par l'API, relatif à l'API)
export const galleryImage = (path) => (path ? `${API_BASE}${path}` : null);

const MONTH = { month: 'short', year: 'numeric', timeZone: 'Europe/Paris' };
const DAY = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Paris' };
const fmt = (value, options) => new Date(value).toLocaleDateString('fr-FR', options);

// Période d'un album : « 14 juil. 2024 », « juil. 2024 », « mars – juil. 2024 », « nov. 2023 – juil. 2024 »
export function albumPeriod(first, last) {
  if (!first || !last) return '';
  if (fmt(first, DAY) === fmt(last, DAY)) return fmt(first, DAY);
  if (fmt(first, MONTH) === fmt(last, MONTH)) return fmt(first, MONTH);
  const sameYear = new Date(first).getFullYear() === new Date(last).getFullYear();
  return `${sameYear ? fmt(first, { month: 'short', timeZone: 'Europe/Paris' }) : fmt(first, MONTH)} – ${fmt(last, MONTH)}`;
}

const photoCount = (n) => `${n} photo${n > 1 ? 's' : ''}`;

export const formatDateTime = (value) =>
  new Date(value).toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

// Carte d'album : couverture, nom, nombre de photos (sous-albums compris), période
export function AlbumCard({ album }) {
  const cover = galleryImage(album.cover?.thumbSm);
  return (
    <li>
      <Link to={`/galerie/${album.id}`} className="card album-card">
        <span className="album-cover">
          {cover ? <img src={cover} alt="" loading="lazy" decoding="async" /> : <span className="album-cover-empty" aria-hidden="true">📷</span>}
        </span>
        <span className="album-card-body">
          <span className="album-card-name">{album.name}</span>
          <span className="muted small">
            {photoCount(album.totalPhotoCount)}
            {album.firstTakenAt && ` · ${albumPeriod(album.firstTakenAt, album.lastTakenAt)}`}
          </span>
        </span>
      </Link>
    </li>
  );
}

export function AlbumSkeletons({ count = 6 }) {
  return (
    <ul className="album-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i}>
          <div className="card album-card album-card-skeleton">
            <span className="album-cover skeleton" />
            <span className="album-card-body">
              <span className="skeleton skeleton-line" />
              <span className="skeleton skeleton-line short" />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

// Bureau : date de la dernière synchro, bouton « Synchroniser », lien vers le Drive partagé
function SyncPanel({ onSynced }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [waiting, setWaiting] = useState(false);
  const timer = useRef(null);

  const load = useCallback(
    () =>
      api
        .get('/gallery/sync/status')
        .then(({ data }) => {
          setStatus(data);
          return data;
        })
        .catch((err) => setError(errorMessage(err, "Impossible de lire l'état de la synchro"))),
    []
  );
  useEffect(() => {
    load();
    return () => clearTimeout(timer.current);
  }, [load]);

  // La synchro est faite par le service gallery-worker : on suit son état jusqu'à la fin (2 min au plus)
  const sync = async () => {
    setError('');
    setWaiting(true);
    const before = status?.lastSyncAt;
    try {
      await api.post('/gallery/sync');
    } catch (err) {
      setError(errorMessage(err, 'Impossible de lancer la synchro'));
      setWaiting(false);
      return;
    }
    const started = Date.now();
    const poll = async () => {
      const data = await load();
      const done = data && !data.running && !data.requestedAt && data.lastSyncAt !== before;
      if (done || Date.now() - started > 120000) {
        setWaiting(false);
        if (done) onSynced();
        else setError("La synchro n'a pas répondu à temps : le service gallery-worker tourne-t-il ?");
        return;
      }
      timer.current = setTimeout(poll, 3000);
    };
    timer.current = setTimeout(poll, 2000);
  };

  if (!status) return error ? <div role="alert" className="alert alert-error">{error}</div> : null;
  if (!status.configured) {
    return (
      <div role="status" className="alert alert-info">
        Galerie pas encore reliée à un Drive partagé : renseigner GALLERY_SHARED_DRIVE_ID sur le serveur (README, section « Galerie »).
      </div>
    );
  }
  const errorIsRecent = status.lastError && (!status.lastSyncAt || new Date(status.lastErrorAt) > new Date(status.lastSyncAt));
  return (
    <section className="card gallery-sync" aria-label="Synchronisation avec le Drive (bureau)">
      <div className="gallery-sync-text">
        <strong>Drive partagé</strong>
        <span className="muted small">
          {status.lastSyncAt ? `Dernière synchro le ${formatDateTime(status.lastSyncAt)}` : 'Jamais synchronisé'} · automatique toutes les{' '}
          {status.intervalMinutes} min · {photoCount(status.counts.photos)}
          {status.counts.thumbsPending > 0 && ` · ${status.counts.thumbsPending} miniature(s) en préparation`}
          {status.counts.thumbsError > 0 && ` · ${status.counts.thumbsError} photo(s) illisible(s)`}
        </span>
        {errorIsRecent && (
          <span className="gallery-sync-error small">
            Dernière erreur ({formatDateTime(status.lastErrorAt)}) : {status.lastError}
          </span>
        )}
      </div>
      <div className="gallery-sync-actions">
        {status.driveUrl && (
          <a href={status.driveUrl} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
            Ouvrir dans le Drive
          </a>
        )}
        <button type="button" className="btn btn-primary btn-sm" onClick={sync} disabled={waiting || status.running}>
          {waiting || status.running ? 'Synchronisation…' : 'Synchroniser'}
        </button>
      </div>
      {error && <div role="alert" className="alert alert-error gallery-sync-alert">{error}</div>}
    </section>
  );
}

// Galerie : albums de premier niveau (les sous-albums sont dans leur album parent)
export default function Galerie() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(
    () =>
      api
        .get('/gallery/albums')
        .then(({ data: res }) => setData(res))
        .catch((err) => setError(errorMessage(err, 'Impossible de charger la galerie'))),
    []
  );
  useEffect(() => {
    load();
  }, [load]);

  const ids = new Set((data?.albums || []).map((a) => a.id));
  const topLevel = (data?.albums || []).filter((a) => !a.parentId || !ids.has(a.parentId));

  return (
    <div className="gallery">
      <div className="page-header">
        <div>
          <h1>Galerie</h1>
          <p className="muted">Les photos de l’association, rangées par album.</p>
        </div>
      </div>

      {data?.canManage && <SyncPanel onSynced={load} />}
      {error && <div role="alert" className="alert alert-error">{error}</div>}

      {!data && !error && (
        <>
          <p className="sr-only" role="status">Chargement des albums…</p>
          <AlbumSkeletons />
        </>
      )}
      {data && topLevel.length === 0 && (
        <div className="card empty-state">
          <h2>Aucun album</h2>
          <p className="muted">Dépose des photos dans le Drive partagé : elles apparaîtront ici après la prochaine synchro.</p>
        </div>
      )}
      {topLevel.length > 0 && (
        <ul className="album-grid">
          {topLevel.map((album) => (
            <AlbumCard key={album.id} album={album} />
          ))}
        </ul>
      )}
    </div>
  );
}
