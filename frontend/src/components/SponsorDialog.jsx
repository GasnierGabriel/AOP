import { useEffect, useState } from 'react';
import { errorMessage } from '../api';
import { CONTRIBUTION_TYPES, SPONSOR_STATUSES } from '../sponsoringConfig';

const fromSponsor = (s) => ({
  name: s?.name || '',
  status: s?.status || 'to_contact',
  contributionType: s?.contributionType || 'money',
  amount: s?.amount ?? '',
  contributionDetails: s?.contributionDetails || '',
  contactName: s?.contactName || '',
  contactEmail: s?.contactEmail || '',
  contactPhone: s?.contactPhone || '',
  website: s?.website || '',
  ownerId: s?.owner?.id ?? '',
  tierId: s?.tier?.id ?? '',
  nextActionDate: s?.nextActionDate || '',
  notes: s?.notes || '',
});

const NEW_TIER = '__new';

// Création / modification d'un partenaire.
// presetStatus : statut imposé à l'ouverture (ex : passage en « Signé » depuis le tableau, rang à choisir)
export default function SponsorDialog({ sponsor, team, tiers, presetStatus, defaultOwnerId, onCreateTier, onSave, onDelete, onClose }) {
  const isEdit = Boolean(sponsor?.id);
  const [form, setForm] = useState(() => ({
    ...fromSponsor(sponsor),
    ...(isEdit ? {} : { ownerId: defaultOwnerId ?? '' }),
    ...(presetStatus ? { status: presetStatus } : {}),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newTier, setNewTier] = useState(null); // { name, color } pendant la création d'un rang
  const signed = form.status === 'signed';

  const createTier = async () => {
    if (!newTier.name.trim()) return setError('Donne un nom au nouveau rang');
    setError('');
    try {
      const tier = await onCreateTier(newTier);
      setForm((prev) => ({ ...prev, tierId: tier.id }));
      setNewTier(null);
    } catch (err) {
      setError(errorMessage(err, 'Impossible de créer le rang'));
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [busy, onClose]);

  const update = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

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

  const handleSubmit = (e) => {
    e.preventDefault();
    run(
      () =>
        onSave({
          ...form,
          amount: form.amount === '' ? null : Number(form.amount),
          ownerId: form.ownerId === '' ? null : Number(form.ownerId),
          tierId: form.tierId === '' ? null : Number(form.tierId),
          nextActionDate: form.nextActionDate || null,
        }),
      "Impossible d'enregistrer le partenaire"
    );
  };

  const handleDelete = () => {
    if (window.confirm(`Supprimer définitivement « ${sponsor.name} » et tout son suivi ?`)) {
      run(onDelete, 'Impossible de supprimer le partenaire');
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="sponsor-dialog-title">
        <h2 id="sponsor-dialog-title">{isEdit ? sponsor.name : 'Nouveau partenaire'}</h2>
        <form className="form" onSubmit={handleSubmit}>
          <div className="form-grid">
            <label className="span-2">
              Nom du partenaire
              <input value={form.name} onChange={update('name')} maxLength={200} required autoFocus={!isEdit} />
            </label>
            <label>
              Statut
              <select value={form.status} onChange={update('status')}>
                {SPONSOR_STATUSES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={signed && !form.tierId ? 'field-required' : undefined}>
              {signed ? 'Rang (obligatoire une fois signé)' : 'Rang (visé)'}
              <select
                value={newTier ? NEW_TIER : form.tierId}
                onChange={(e) => {
                  if (e.target.value === NEW_TIER) setNewTier({ name: '', color: '#3498db' });
                  else {
                    setNewTier(null);
                    update('tierId')(e);
                  }
                }}
                required={signed}
                autoFocus={Boolean(presetStatus)}
              >
                <option value="">{signed ? '— Choisir un rang —' : '— Aucun —'}</option>
                {tiers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
                <option value={NEW_TIER}>+ Nouveau rang…</option>
              </select>
            </label>
            {newTier && (
              <div className="span-2 new-tier">
                <input
                  value={newTier.name}
                  onChange={(e) => setNewTier({ ...newTier, name: e.target.value })}
                  placeholder="Nom du rang, ex : Diamant, Partenaire technique…"
                  maxLength={40}
                  aria-label="Nom du nouveau rang"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      createTier();
                    }
                  }}
                />
                <input
                  type="color"
                  value={newTier.color}
                  onChange={(e) => setNewTier({ ...newTier, color: e.target.value })}
                  aria-label="Couleur du nouveau rang"
                  title="Couleur"
                />
                <button type="button" className="btn btn-primary btn-sm" onClick={createTier}>
                  Créer
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNewTier(null)}>
                  Annuler
                </button>
              </div>
            )}
            <label>
              Responsable
              <select value={form.ownerId} onChange={update('ownerId')}>
                <option value="">— Personne —</option>
                {team.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Type d'apport
              <select value={form.contributionType} onChange={update('contributionType')}>
                {CONTRIBUTION_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {form.contributionType === 'money' ? 'Montant (€)' : 'Valeur estimée (€)'}
              <input type="number" min={0} step="1" value={form.amount} onChange={update('amount')} placeholder="ex : 1500" />
            </label>
            <label className="span-2">
              Détail de l'apport
              <input
                value={form.contributionDetails}
                onChange={update('contributionDetails')}
                maxLength={1000}
                placeholder="ex : 10 licences logiciel, capteurs lidar, usinage de pièces…"
              />
            </label>
            <label>
              Prochaine relance
              <input type="date" value={form.nextActionDate} onChange={update('nextActionDate')} />
            </label>
            <label>
              Site web
              <input type="url" value={form.website} onChange={update('website')} placeholder="https://…" maxLength={500} />
            </label>
          </div>

          <fieldset className="form-fieldset">
            <legend>Contact</legend>
            <div className="form-grid">
              <label className="span-2">
                Nom
                <input value={form.contactName} onChange={update('contactName')} maxLength={200} placeholder="ex : Marie Durand, responsable RSE" />
              </label>
              <label>
                Email
                <input type="email" value={form.contactEmail} onChange={update('contactEmail')} maxLength={255} />
              </label>
              <label>
                Téléphone
                <input type="tel" value={form.contactPhone} onChange={update('contactPhone')} maxLength={50} />
              </label>
            </div>
          </fieldset>

          <label>
            Notes
            <textarea
              rows={4}
              value={form.notes}
              onChange={update('notes')}
              maxLength={5000}
              placeholder="Historique des échanges, contreparties promises (logo, posts…), points d'attention…"
            />
          </label>

          {error && <div className="alert alert-error">{error}</div>}
          <div className="modal-actions">
            {isEdit && (
              <button type="button" className="btn btn-danger" onClick={handleDelete} disabled={busy}>
                Supprimer
              </button>
            )}
            <span className="spacer" />
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {isEdit ? 'Enregistrer' : 'Ajouter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
