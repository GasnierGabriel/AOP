import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api, { errorMessage } from '../api';
import Markdown from '../components/Markdown';
import { formatDate } from '../utils';

const formatDateTime = (value) =>
  new Date(value).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Lecture d'une page du wiki, avec son historique de versions
export default function WikiPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [page, setPage] = useState(null);
  const [canDelete, setCanDelete] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState(null); // null = fermé, [] = liste chargée
  const [revision, setRevision] = useState(null); // version ancienne affichée
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const load = () =>
    api
      .get(`/wiki/pages/${slug}`)
      .then(({ data }) => {
        setPage(data.page);
        setCanDelete(data.canDelete);
      })
      .catch((err) => setError(errorMessage(err, 'Impossible de charger la page')));

  useEffect(() => {
    setPage(null);
    setHistory(null);
    setRevision(null);
    load();
  }, [slug]);

  const toggleHistory = async () => {
    if (history) {
      setHistory(null);
      setRevision(null);
      return;
    }
    try {
      const { data } = await api.get(`/wiki/pages/${slug}/revisions`);
      setHistory(data.revisions);
    } catch (err) {
      setActionError(errorMessage(err, "Impossible de charger l'historique"));
    }
  };

  const showRevision = async (id) => {
    try {
      const { data } = await api.get(`/wiki/pages/${slug}/revisions/${id}`);
      setRevision(data.revision);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setActionError(errorMessage(err, 'Impossible de charger cette version'));
    }
  };

  // Restaurer = enregistrer l'ancienne version comme nouvelle version (rien n'est perdu)
  const restore = async () => {
    if (!window.confirm(`Restaurer la version du ${formatDateTime(revision.createdAt)} ? La version actuelle restera dans l'historique.`)) return;
    setBusy(true);
    setActionError('');
    try {
      await api.put(`/wiki/pages/${slug}`, {
        title: revision.title,
        content: revision.content,
        categoryId: revision.categoryId || page.category.id,
        baseUpdatedAt: page.updatedAt,
      });
      setRevision(null);
      setHistory(null);
      await load();
    } catch (err) {
      setActionError(errorMessage(err, 'Impossible de restaurer cette version'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Supprimer définitivement la page « ${page.title} » et tout son historique ?`)) return;
    setBusy(true);
    try {
      await api.delete(`/wiki/pages/${slug}`);
      navigate(`/wiki/c/${page.category.slug}`, { replace: true });
    } catch (err) {
      setActionError(errorMessage(err, 'Impossible de supprimer la page'));
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="card empty-state">
        <h2>{error}</h2>
        <Link to="/wiki">← Retour au wiki</Link>
      </div>
    );
  }
  if (!page) return <div className="loading">Chargement…</div>;

  const shown = revision || page;

  return (
    <div className="wiki wiki-page">
      <nav className="breadcrumb" aria-label="Fil d'Ariane">
        <Link to="/wiki">Wiki</Link> <span aria-hidden="true">›</span>{' '}
        <Link to={`/wiki/c/${page.category.slug}`}>
          {page.category.emoji} {page.category.name}
        </Link>
      </nav>

      <div className="page-header">
        <div>
          <h1>{page.title}</h1>
          <p className="muted small">
            Créée le {formatDate(page.createdAt)}
            {page.createdBy && ` par ${page.createdBy.fullName}`} · modifiée le {formatDateTime(page.updatedAt)}
            {page.updatedBy && ` par ${page.updatedBy.fullName}`}
          </p>
        </div>
        <div className="wiki-header-actions">
          <button type="button" className="btn btn-outline btn-sm" onClick={toggleHistory}>
            Historique ({page.revisionCount})
          </button>
          {canDelete && (
            <button type="button" className="btn btn-outline btn-sm btn-outline-danger" onClick={remove} disabled={busy}>
              Supprimer
            </button>
          )}
          <Link to={`/wiki/p/${slug}/modifier`} className="btn btn-light">
            ✎ Modifier
          </Link>
        </div>
      </div>

      {actionError && <div className="alert alert-error">{actionError}</div>}

      {revision && (
        <div className="alert alert-info revision-banner">
          <span>
            Ancienne version du <strong>{formatDateTime(revision.createdAt)}</strong>
            {revision.editedBy && ` par ${revision.editedBy.fullName}`}
          </span>
          <span className="revision-actions">
            <button type="button" className="btn btn-light btn-sm" onClick={restore} disabled={busy}>
              Restaurer cette version
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setRevision(null)}>
              Revenir à la version actuelle
            </button>
          </span>
        </div>
      )}

      <div className="wiki-layout">
        <article className="card wiki-content">
          {revision && revision.title !== page.title && <h2 className="revision-title">{revision.title}</h2>}
          <Markdown source={shown.content} toc />
        </article>

        {history && (
          <aside className="card wiki-history">
            <h2>Historique</h2>
            <ol>
              {history.map((r, i) => (
                <li key={r.id} className={revision?.id === r.id ? 'is-selected' : undefined}>
                  <button type="button" onClick={() => (i === 0 ? setRevision(null) : showRevision(r.id))}>
                    <strong>{formatDateTime(r.createdAt)}</strong>
                    <span className="muted small">
                      {r.editedBy?.fullName || 'Ancien membre'}
                      {i === 0 && ' · version actuelle'}
                      {i === history.length - 1 && i !== 0 && ' · création'}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </aside>
        )}
      </div>
    </div>
  );
}
