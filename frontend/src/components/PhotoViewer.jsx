import { useEffect, useRef, useState } from 'react';
import api, { API_BASE, errorMessage } from '../api';
import Modal from './Modal';

const SWIPE_MIN_PX = 50;

const formatTakenAt = (value) =>
  new Date(value).toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

// Visionneuse plein écran (fenêtre native : focus piégé, Échap, geste retour) : flèches du clavier, balayage sur mobile,
// compteur « 12 / 148 », téléchargement de l'original, préchargement des photos voisines.
// Bureau (coverTargets) : choisir la photo comme couverture de son album ou d'un album parent.
export default function PhotoViewer({ photos, index, total, canManage, coverTargets, onSetCover, onIndexChange, onClose, onNeedMore }) {
  const photo = photos[index];
  const [downloadError, setDownloadError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [coverMenu, setCoverMenu] = useState(false);
  const [coverStatus, setCoverStatus] = useState('');
  const [coverBusy, setCoverBusy] = useState(false);
  const swipe = useRef(null);
  const hasPrev = index > 0;
  const hasNext = index < photos.length - 1;

  const go = (delta) => {
    const next = index + delta;
    if (next >= 0 && next < photos.length) onIndexChange(next);
  };

  // Flèches du clavier (la fenêtre a le focus pendant qu'elle est ouverte)
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  // Photos voisines préchargées ; page suivante demandée à l'approche de la fin de la liste
  useEffect(() => {
    setDownloadError('');
    setCoverStatus('');
    setCoverMenu(false);
    for (const neighbour of [photos[index + 1], photos[index - 1]]) {
      if (neighbour?.thumbLg) new Image().src = `${API_BASE}${neighbour.thumbLg}`;
    }
    if (index >= photos.length - 5) onNeedMore?.();
  }, [index, photos, onNeedMore]);

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse') return;
    swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  };

  // Lien d'original redemandé au moment du clic : les liens signés expirent au bout d'une heure ou deux
  const download = async () => {
    setDownloading(true);
    setDownloadError('');
    try {
      const { data } = await api.get(`/gallery/photos/${photo.id}`);
      window.location.assign(`${API_BASE}${data.photo.originalUrl}`);
    } catch (err) {
      setDownloadError(errorMessage(err, 'Téléchargement impossible'));
    } finally {
      setDownloading(false);
    }
  };

  const chooseCover = async (target) => {
    setCoverBusy(true);
    setDownloadError('');
    try {
      await onSetCover(target.id, photo.id);
      setCoverStatus(`Couverture de « ${target.name} » mise à jour`);
      setCoverMenu(false);
    } catch (err) {
      setDownloadError(errorMessage(err, 'Impossible de changer la couverture'));
    } finally {
      setCoverBusy(false);
    }
  };

  if (!photo) return null;
  const src = photo.thumbLg ? `${API_BASE}${photo.thumbLg}` : null;

  return (
    <Modal onClose={onClose} className="photo-viewer" labelledBy="photo-viewer-title">
      <div className="photo-viewer-bar">
        <p id="photo-viewer-title" className="photo-viewer-title">
          <span className="photo-viewer-counter">
            {index + 1} / {Math.max(total, photos.length)}
          </span>
          <span className="photo-viewer-date">{formatTakenAt(photo.takenAt)}</span>
        </p>
        <div className="photo-viewer-actions">
          {coverTargets?.length > 0 && photo.thumbSm && (
            <div className="photo-viewer-cover">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setCoverMenu((open) => !open)}
                aria-expanded={coverMenu}
                aria-controls="photo-viewer-cover-menu"
                aria-label="Choisir comme couverture d’album"
              >
                <span aria-hidden="true">★</span>
                <span className="photo-viewer-label" aria-hidden="true">
                  Couverture
                </span>
              </button>
              {coverMenu && (
                <ul id="photo-viewer-cover-menu" className="photo-viewer-menu">
                  {coverTargets.map((target) => {
                    const current = target.coverId === photo.id;
                    return (
                      <li key={target.id}>
                        <button type="button" onClick={() => chooseCover(target)} disabled={coverBusy || current}>
                          {current ? '✓ Couverture actuelle de' : 'Couverture de'} « {target.name} »
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
          {canManage && photo.driveUrl && (
            <a href={photo.driveUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm photo-viewer-drive">
              Drive
            </a>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={download} disabled={downloading} aria-label="Télécharger l’original">
            <span aria-hidden="true">⤓</span>
            <span className="photo-viewer-label" aria-hidden="true">
              {downloading ? 'Téléchargement…' : 'Télécharger l’original'}
            </span>
          </button>
          <button type="button" className="btn btn-ghost btn-sm photo-viewer-close" onClick={onClose} aria-label="Fermer la visionneuse" data-autofocus>
            ✕
          </button>
        </div>
      </div>
      {downloadError && <div role="alert" className="alert alert-error photo-viewer-alert">{downloadError}</div>}
      <p role="status" className={coverStatus ? 'alert alert-success photo-viewer-alert' : 'sr-only'}>
        {coverStatus}
      </p>

      <div className="photo-viewer-stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => (swipe.current = null)}>
        {src ? (
          <img key={photo.id} src={src} alt={photo.filename} className="photo-viewer-img" decoding="async" />
        ) : (
          <p className="photo-viewer-pending">Miniature en préparation : elle sera visible après le passage du service de la galerie.</p>
        )}
        <button type="button" className="photo-viewer-nav prev" onClick={() => go(-1)} disabled={!hasPrev} aria-label="Photo précédente">
          ‹
        </button>
        <button type="button" className="photo-viewer-nav next" onClick={() => go(1)} disabled={!hasNext} aria-label="Photo suivante">
          ›
        </button>
      </div>
      <p className="photo-viewer-filename small">{photo.filename}</p>
    </Modal>
  );
}
