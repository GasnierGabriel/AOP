import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api, { errorMessage } from '../api';
import Markdown from '../components/Markdown';

const TEMPLATE = `## Objectif

Pourquoi ce process existe, à qui il sert.

## Étapes

1. Première étape
2. Deuxième étape

## Contacts / ressources

- Qui contacter :
- Liens utiles :
`;

// Création (/wiki/nouveau) ou modification (/wiki/p/:slug/modifier) d'une page
export default function WikiEditor() {
  const { slug } = useParams();
  const isEdit = Boolean(slug);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({ title: '', categoryId: '', content: isEdit ? '' : TEMPLATE });
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(null);
  const [tab, setTab] = useState('write');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const initial = useRef(null); // contenu de départ, pour détecter les changements non enregistrés

  useEffect(() => {
    const loadCategories = api.get('/wiki/categories').then(({ data }) => data.categories);
    const loadPage = isEdit ? api.get(`/wiki/pages/${slug}`).then(({ data }) => data.page) : Promise.resolve(null);
    Promise.all([loadCategories, loadPage])
      .then(([cats, page]) => {
        setCategories(cats);
        const start = page
          ? { title: page.title, categoryId: String(page.category.id), content: page.content }
          : {
              title: '',
              categoryId: String(cats.find((c) => c.slug === params.get('categorie'))?.id || cats[0]?.id || ''),
              content: TEMPLATE,
            };
        setForm(start);
        initial.current = start;
        if (page) setBaseUpdatedAt(page.updatedAt);
      })
      .catch((err) => setError(errorMessage(err, 'Impossible de charger la page')))
      .finally(() => setLoading(false));
  }, [slug]);

  const dirty =
    initial.current &&
    (form.title !== initial.current.title ||
      form.content !== initial.current.content ||
      form.categoryId !== initial.current.categoryId);

  // Avertit avant de quitter l'onglet avec des changements non enregistrés
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = async (e) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const payload = { ...form, categoryId: Number(form.categoryId) };
      const { data } = isEdit
        ? await api.put(`/wiki/pages/${slug}`, { ...payload, baseUpdatedAt })
        : await api.post('/wiki/pages', payload);
      initial.current = form; // plus de changements en attente
      navigate(`/wiki/p/${data.page.slug}`);
    } catch (err) {
      setError(errorMessage(err, "Impossible d'enregistrer la page"));
      setBusy(false);
    }
  };

  // Ctrl+S / Cmd+S pour enregistrer
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        document.getElementById('wiki-editor-form')?.requestSubmit();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const cancel = () => {
    if (dirty && !window.confirm('Abandonner les modifications non enregistrées ?')) return;
    initial.current = form;
    navigate(isEdit ? `/wiki/p/${slug}` : '/wiki');
  };

  if (loading) return <div className="loading">Chargement…</div>;
  if (error && !initial.current) return <div className="alert alert-error">{error}</div>;

  return (
    <div className="wiki wiki-editor">
      <nav className="breadcrumb" aria-label="Fil d'Ariane">
        <Link to="/wiki">Wiki</Link> <span aria-hidden="true">›</span>{' '}
        <span>{isEdit ? `Modifier « ${initial.current?.title} »` : 'Nouvelle page'}</span>
      </nav>

      <form id="wiki-editor-form" className="card form wiki-form" onSubmit={save}>
        <div className="form-grid">
          <label className="span-2">
            Titre
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              maxLength={200}
              required
              autoFocus={!isEdit}
              placeholder="ex : Faire une note de frais"
            />
          </label>
          <label>
            Catégorie
            <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} required>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="editor-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'write'} className={tab === 'write' ? 'is-active' : ''} onClick={() => setTab('write')}>
            Écrire
          </button>
          <button type="button" role="tab" aria-selected={tab === 'preview'} className={tab === 'preview' ? 'is-active' : ''} onClick={() => setTab('preview')}>
            Aperçu
          </button>
          <span className="muted small editor-hint">Markdown · Ctrl+S pour enregistrer</span>
        </div>

        {tab === 'write' ? (
          <textarea
            className="editor-textarea"
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            rows={22}
            maxLength={100000}
            aria-label="Contenu de la page (Markdown)"
            spellCheck
          />
        ) : (
          <div className="editor-preview">
            <Markdown source={form.content} />
          </div>
        )}

        <details className="markdown-help">
          <summary>Aide Markdown</summary>
          <table>
            <tbody>
              <tr><td><code>## Titre</code></td><td>Titre de section (### pour un sous-titre)</td></tr>
              <tr><td><code>**gras**</code> · <code>*italique*</code></td><td>Mise en forme</td></tr>
              <tr><td><code>- élément</code> · <code>1. élément</code></td><td>Listes à puces / numérotées</td></tr>
              <tr><td><code>- [ ] tâche</code></td><td>Case à cocher</td></tr>
              <tr><td><code>[texte](https://…)</code></td><td>Lien</td></tr>
              <tr><td><code>![légende](https://…/image.png)</code></td><td>Image (par lien)</td></tr>
              <tr><td><code>`code`</code> · <code>```</code> bloc <code>```</code></td><td>Code</td></tr>
              <tr><td><code>&gt; texte</code></td><td>Encadré / citation</td></tr>
              <tr><td><code>| A | B |</code> puis <code>|---|---|</code></td><td>Tableau</td></tr>
            </tbody>
          </table>
        </details>

        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={cancel} disabled={busy}>
            Annuler
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Enregistrement…' : isEdit ? 'Enregistrer' : 'Publier la page'}
          </button>
        </div>
      </form>
    </div>
  );
}
