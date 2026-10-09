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
  nextActionDate: s?.nextActionDate || '',
  notes: s?.notes || '',
});

// Création / modification d'un partenaire
export default function SponsorDialog({ sponsor, team, defaultOwnerId, onSave, onDelete, onClose }) {
  const isEdit = Boolean(sponsor?.id);
  const [form, setForm] = useState(() => ({ ...fromSponsor(sponsor), ...(isEdit ? {} : { ownerId: defaultOwnerId ?? '' }) }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
