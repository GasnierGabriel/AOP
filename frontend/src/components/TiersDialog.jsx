import { useEffect, useState } from 'react';
import api, { errorMessage } from '../api';
import TagPill from './TagPill';

// Gestion des rangs de sponsoring : renommer, changer la couleur, créer, supprimer (si inutilisé)
export default function TiersDialog({ tiers: initialTiers, onClose }) {
  const [tiers, setTiers] = useState(initialTiers);
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
        const { data } = await api.patch(`/sponsoring/tiers/${editing.id}`, { name, color });
        setTiers((list) => list.map((t) => (t.id === data.tier.id ? { ...t, ...data.tier } : t)));
      } else {
        const { data } = await api.post('/sponsoring/tiers', { name, color });
        setTiers((list) => [...list, data.tier]);
      }
      setEditing(null);
    }, "Impossible d'enregistrer le rang");
  };

  const remove = (tier) => {
    if (!window.confirm(`Supprimer le rang « ${tier.name} » ?`)) return;
    run(async () => {
      await api.delete(`/sponsoring/tiers/${tier.id}`);
      setTiers((list) => list.filter((t) => t.id !== tier.id));
    }, 'Impossible de supprimer le rang');
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="tiers-title">
        <h2 id="tiers-title">Rangs de sponsoring</h2>
        <p className="muted small">Du plus bas au plus élevé. Un partenaire signé doit avoir un rang.</p>

        <ul className="tier-list">
          {tiers.map((tier) =>
            editing?.id === tier.id ? null : (
              <li key={tier.id}>
                <TagPill tag={tier} />
                <span className="muted small">
                  {tier.sponsorCount ?? 0} partenaire{(tier.sponsorCount ?? 0) > 1 ? 's' : ''}
                </span>
                <span className="tier-actions">
                  <button type="button" className="icon-btn" onClick={() => setEditing(tier)} disabled={busy} title="Modifier" aria-label={`Modifier ${tier.name}`}>
                    ✎
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger"
                    onClick={() => remove(tier)}
                    disabled={busy || tier.sponsorCount > 0}
                    title={tier.sponsorCount > 0 ? 'Attribué à des partenaires' : 'Supprimer'}
                    aria-label={`Supprimer ${tier.name}`}
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
              placeholder="Nom du rang"
              maxLength={40}
              required
              autoFocus
              aria-label="Nom du rang"
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
            + Nouveau rang
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
