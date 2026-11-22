import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api, { errorMessage } from '../api';
import { formatDate } from '../utils';
import useModal from '../useModal';

// Ligne de liste : titre, catégorie (si mélangées), extrait, dernière modification
export function WikiPageItem({ page, showCategory }) {
  return (
    <li className="wiki-item">
      <div className="wiki-item-head">
        <Link to={`/wiki/p/${page.slug}`} className="wiki-item-title">
          {page.title}
        </Link>
        {showCategory && (
          <Link to={`/wiki/c/${page.category.slug}`} className="chip wiki-chip">
            {page.category.emoji} {page.category.name}
          </Link>
        )}
      </div>
      {page.excerpt && <p className="wiki-item-excerpt">{page.excerpt}</p>}
      <span className="muted small">
        Modifié le {formatDate(page.updatedAt)}
        {page.updatedBy && ` par ${page.updatedBy.fullName}`}
      </span>
    </li>
  );
}

function CategoryDialog({ category, onSaved, onDeleted, onClose }) {
  const isEdit = Boolean(category?.id);
  const [form, setForm] = useState({
    name: category?.name || '',
    emoji: category?.emoji || '',
    description: category?.description || '',
  });
  const [busy, setBusy] = useState(false);
  const modalRef = useModal({ onClose, busy });
  const [error, setError] = useState('');

  const run = async (action, fallback) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err, fallback));
      setBusy(false);
    }
  };

  const save = (e) => {
    e.preventDefault();
    run(async () => {
      const { data } = isEdit
        ? await api.patch(`/wiki/categories/${category.id}`, form)
        : await api.post('/wiki/categories', form);
      onSaved(data.category);
    }, "Impossible d'enregistrer la catégorie");
  };

  const remove = () => {
    if (!window.confirm(`Supprimer la catégorie « ${category.name} » ?`)) return;
    run(async () => {
      await api.delete(`/wiki/categories/${category.id}`);
      onDeleted();
    }, 'Impossible de supprimer la catégorie');
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" ref={modalRef} tabIndex={-1} aria-modal="true" aria-labelledby="category-title">
        <h2 id="category-title">{isEdit ? 'Modifier la catégorie' : 'Nouvelle catégorie'}</h2>
        <form className="form" onSubmit={save}>
          <div className="form-grid">
            <label className="span-2">
              Nom
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} required autoFocus />
            </label>
            <label>
              Emoji
              <input value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} maxLength={8} placeholder="ex : 🔧" />
            </label>
          </div>
          <label>
            Description
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              maxLength={300}
              placeholder="Ce qu'on trouve dans cette catégorie"
            />
          </label>
          {error && <div role="alert" className="alert alert-error">{error}</div>}
          <div className="modal-actions">
            {isEdit && (
              <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
                Supprimer
              </button>
            )}
            <span className="spacer" />
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {isEdit ? 'Enregistrer' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Accueil du wiki (catégories + dernières modifications) ou page d'une catégorie (/wiki/c/:slug)
export default function Wiki() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const search = params.get('q') || '';
  const [categories, setCategories] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null); // null | {} | catégorie

  const category = slug ? categories.find((c) => c.slug === slug) : null;

  useEffect(() => {
    api
      .get('/wiki/categories')
      .then(({ data }) => {
        setCategories(data.categories);
        setCanManage(data.canManage);
      })
      .catch((err) => setError(errorMessage(err, 'Impossible de charger le wiki')));
  }, []);

  // Pages : recherche (toutes catégories), catégorie (ordre alphabétique) ou dernières modifications
  useEffect(() => {
    const timer = setTimeout(() => {
      const query = { tri: slug && !search ? 'titre' : 'recent' };
      if (slug) query.categorie = slug;
      if (search.trim()) query.q = search.trim();
      api
        .get('/wiki/pages', { params: query })
        .then(({ data }) => setPages(data.pages))
        .catch((err) => setError(errorMessage(err, 'Impossible de charger les pages')))
        .finally(() => setLoading(false));
    }, search ? 250 : 0); // petite attente pendant la frappe
    return () => clearTimeout(timer);
  }, [slug, search]);

  const newPageLink = `/wiki/nouveau${slug ? `?categorie=${slug}` : ''}`;
  const recent = !slug && !search ? pages.slice(0, 8) : pages;

  if (error) return <div role="alert" className="alert alert-error">{error}</div>;
  if (slug && categories.length > 0 && !category) {
    return (
      <div className="card empty-state">
        <h2>Catégorie introuvable</h2>
        <Link to="/wiki">← Retour au wiki</Link>
      </div>
    );
  }

  return (
    <div className="wiki">
      {slug && (
        <nav className="breadcrumb" aria-label="Fil d'Ariane">
          <Link to="/wiki">Wiki</Link> <span aria-hidden="true">›</span> <span>{category?.name}</span>
        </nav>
      )}

      <div className="page-header">
        <div>
          <h1>{category ? `${category.emoji || ''} ${category.name}`.trim() : 'Wiki'}</h1>
          <p className="muted">
            {category
              ? category.description || 'Pages de cette catégorie'
              : "Les process et savoir-faire de l'asso, écrits par et pour les membres"}
          </p>
        </div>
        <div className="wiki-header-actions">
          {category && canManage && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setDialog(category)}>
              Modifier la catégorie
            </button>
          )}
          <Link to={newPageLink} className="btn btn-light">
            + Nouvelle page
          </Link>
        </div>
      </div>

      <input
        type="search"
        className="search wiki-search"
        aria-label="Rechercher dans le wiki"
        placeholder={category ? `Rechercher dans ${category.name}…` : 'Rechercher dans tout le wiki…'}
        value={search}
        onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })}
      />

      {!slug && !search && (
        <>
          <div className="wiki-categories">
            {categories.map((c) => (
              <Link key={c.id} to={`/wiki/c/${c.slug}`} className="card wiki-category">
                <span className="wiki-category-emoji" aria-hidden="true">
                  {c.emoji || '📁'}
                </span>
                <h2>{c.name}</h2>
                {c.description && <p className="muted small">{c.description}</p>}
                <span className="wiki-category-count">
                  {c.pageCount} page{c.pageCount > 1 ? 's' : ''}
                </span>
              </Link>
            ))}
            {canManage && (
              <button type="button" className="wiki-category wiki-category-add" onClick={() => setDialog({})}>
                + Nouvelle catégorie
              </button>
            )}
          </div>
          <h2 className="wiki-section-title">Dernières modifications</h2>
        </>
      )}

      {search && (
        <p className="muted wiki-section-title">
          {pages.length} résultat{pages.length > 1 ? 's' : ''} pour « {search} »
        </p>
      )}

      {loading ? (
        <div className="loading">Chargement…</div>
      ) : recent.length === 0 ? (
        <div className="card empty-state">
          <p className="muted">
            {search ? 'Aucune page ne correspond.' : 'Aucune page pour l’instant : lance-toi !'}
          </p>
          {!search && (
            <button type="button" className="btn btn-primary" onClick={() => navigate(newPageLink)}>
              + Écrire la première page
            </button>
          )}
        </div>
      ) : (
        <ul className="card wiki-list">
          {recent.map((page) => (
            <WikiPageItem key={page.id} page={page} showCategory={!slug} />
          ))}
        </ul>
      )}

      {dialog && (
        <CategoryDialog
          category={dialog.id ? dialog : null}
          onSaved={(saved) => {
            setCategories((list) =>
              list.some((c) => c.id === saved.id)
                ? list.map((c) => (c.id === saved.id ? { ...c, ...saved, pageCount: c.pageCount } : c))
                : [...list, saved]
            );
            setDialog(null);
          }}
          onDeleted={() => {
            setCategories((list) => list.filter((c) => c.id !== dialog.id));
            setDialog(null);
            navigate('/wiki');
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
