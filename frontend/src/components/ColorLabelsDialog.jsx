import { useEffect, useState } from 'react';
import api, { errorMessage } from '../api';
import TagPill from './TagPill';

// Gestion d'une liste d'étiquettes colorées (rangs de sponsoring, pôles des tâches) :
// renommer, changer la couleur, créer, supprimer (si inutilisée).
// endpoint : route de l'API (GET non utilisé : la liste est fournie), responseKey : clé de l'objet renvoyé,
// countOf / countLabel : nombre d'éléments qui utilisent l'étiquette (suppression impossible au-delà de 0)
export default function ColorLabelsDialog({
  items: initialItems,
  endpoint,
  responseKey,
  title,
  help,
  noun, // ex : « rang », « pôle »
  countOf,
  countLabel,
  onClose,
}) {
  const [items, setItems] = useState(initialItems);
  const [changed, setChanged] = useState(false);
  const [editing, setEditing] = useState(null); // { id?, name, color }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const close = () => !busy && onClose(changed);

  useEffect(() => {
    const handleKeyDown = (e) => e.key === 'Escape' && close();
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  });

  const run = async (action, fallback) => {
    setBusy(true);
    setError('');
    try {
      await action();
      setChanged(true);
    } catch (err) {
      setError(errorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const save = (e) => {
    e.preventDefault();
    run(async () => {
      const { name, color } = editing;
      if (editing.id) {
        const { data } = await api.patch(`${endpoint}/${editing.id}`, { name, color });
        const updated = data[responseKey];
        setItems((list) => list.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)));
      } else {
        const { data } = await api.post(endpoint, { name, color });
        setItems((list) => [...list, data[responseKey]]);
      }
      setEditing(null);
    }, `Impossible d'enregistrer le ${noun}`);
  };

  const remove = (item) => {
    if (!window.confirm(`Supprimer le ${noun} « ${item.name} » ?`)) return;
    run(async () => {
      await api.delete(`${endpoint}/${item.id}`);
      setItems((list) => list.filter((t) => t.id !== item.id));
    }, `Impossible de supprimer le ${noun}`);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="labels-title">
        <h2 id="labels-title">{title}</h2>
        {help && <p className="muted small">{help}</p>}

        <ul className="tier-list">
          {items.map((item) =>
            editing?.id === item.id ? null : (
              <li key={item.id}>
                <TagPill tag={item} />
                <span className="muted small">{countLabel(countOf(item) ?? 0)}</span>
                <span className="tier-actions">
                  <button type="button" className="icon-btn" onClick={() => setEditing(item)} disabled={busy} title="Modifier" aria-label={`Modifier ${item.name}`}>
                    ✎
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger"
                    onClick={() => remove(item)}
                    disabled={busy || countOf(item) > 0}
                    title={countOf(item) > 0 ? 'Encore utilisé' : 'Supprimer'}
                    aria-label={`Supprimer ${item.name}`}
                  >
                    ×
                  </button>
                </span>
              </li>
            )
          )}
        </ul>

        {editing ? (
          <form className="new-tier" onSubmit={save}>
            <input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder={`Nom du ${noun}`}
              maxLength={40}
              required
              autoFocus
              aria-label={`Nom du ${noun}`}
            />
            <input type="color" value={editing.color} onChange={(e) => setEditing({ ...editing, color: e.target.value })} aria-label="Couleur" />
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              {editing.id ? 'Enregistrer' : 'Créer'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)} disabled={busy}>
              Annuler
            </button>
          </form>
        ) : (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing({ name: '', color: '#3498db' })}>
            + Nouveau {noun}
          </button>
        )}

        {error && <div className="alert alert-error section-alert">{error}</div>}
        <div className="modal-actions">
          <span className="spacer" />
          <button type="button" className="btn btn-primary" onClick={close} disabled={busy}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
