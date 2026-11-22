import { useRef, useState } from 'react';
import { errorMessage } from '../api';
import { CONTRIBUTION_TYPES, SPONSOR_STATUSES, counterpartState } from '../sponsoringConfig';
import { formatDate } from '../utils';
import useModal from '../useModal';

const EMPTY_CONTACT = { name: '', role: '', email: '', phone: '' };
const hasContent = (c) => [c.name, c.role, c.email, c.phone].some((v) => v.trim());

const fromSponsor = (s) => ({
  name: s?.name || '',
  status: s?.status || 'to_contact',
  contributionType: s?.contributionType || 'money',
  amount: s?.amount ?? '',
  contributionDetails: s?.contributionDetails || '',
  // Un contact vide à remplir si le partenaire n'en a pas encore
  contacts: s?.contacts?.length ? s.contacts.map((c) => ({ ...c, key: c.id })) : [{ ...EMPTY_CONTACT, key: 'new-0' }],
  website: s?.website || '',
  ownerId: s?.owner?.id ?? '',
  ownerOther: Boolean(s?.ownerExternal), // responsable hors équipe, saisi à la main
  ownerName: s?.ownerExternal || '',
  tierId: s?.tier?.id ?? '',
  nextActionDate: s?.nextActionDate || '',
  notes: s?.notes || '',
  counterparts: (s?.counterparts || []).map((c) => ({ ...c, key: c.id })),
});

const NEW_TIER = '__new';
const OTHER_OWNER = '__other';

const COUNTERPART_BADGE = { overdue: 'En retard', today: "Aujourd'hui", soon: 'Bientôt' };

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
  const nextKey = useRef(0); // clés des contacts et contreparties pas encore enregistrés
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

  const modalRef = useModal({ onClose, busy });

  const update = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const updateContact = (key, changes) =>
    setForm((prev) => ({ ...prev, contacts: prev.contacts.map((c) => (c.key === key ? { ...c, ...changes } : c)) }));
  const addContact = () => {
    nextKey.current += 1;
    const key = `new-${nextKey.current}`;
    setForm((prev) => ({ ...prev, contacts: [...prev.contacts, { ...EMPTY_CONTACT, key }] }));
  };
  const removeContact = (key) => setForm((prev) => ({ ...prev, contacts: prev.contacts.filter((c) => c.key !== key) }));
  // Le premier contact est le contact principal (affiché dans le tableau)
  const makeMainContact = (key) =>
    setForm((prev) => ({
      ...prev,
      contacts: [...prev.contacts.filter((c) => c.key === key), ...prev.contacts.filter((c) => c.key !== key)],
    }));

  const updateCounterpart = (key, changes) =>
    setForm((prev) => ({
      ...prev,
      counterparts: prev.counterparts.map((c) => (c.key === key ? { ...c, ...changes } : c)),
    }));
  const addCounterpart = () => {
    nextKey.current += 1;
    const key = `new-${nextKey.current}`;
    setForm((prev) => ({
      ...prev,
      counterparts: [...prev.counterparts, { key, label: '', details: '', dueDate: '', done: false }],
    }));
  };
  const removeCounterpart = (key) =>
    setForm((prev) => ({ ...prev, counterparts: prev.counterparts.filter((c) => c.key !== key) }));

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
    if (form.ownerOther && !form.ownerName.trim()) return setError('Indique le nom du responsable');
    // Lignes laissées complètement vides : ignorées
    const counterparts = form.counterparts.filter((c) => c.label.trim() || c.details.trim() || c.dueDate);
    if (counterparts.some((c) => !c.label.trim())) return setError('Chaque contrepartie doit avoir un intitulé');

    const { ownerOther, ownerName, ownerId, contacts: _contacts, counterparts: _, ...fields } = form;
    run(
      () =>
        onSave({
          ...fields,
          amount: form.amount === '' ? null : Number(form.amount),
          ownerId: ownerOther || ownerId === '' ? null : Number(ownerId),
          ownerName: ownerOther ? ownerName : null,
          tierId: form.tierId === '' ? null : Number(form.tierId),
          nextActionDate: form.nextActionDate || null,
          // Contacts laissés complètement vides : ignorés
          contacts: form.contacts.filter(hasContent).map((c) => ({
            id: typeof c.key === 'number' ? c.key : undefined,
            name: c.name,
            role: c.role,
            email: c.email,
            phone: c.phone,
          })),
          counterparts: counterparts.map((c) => ({
            id: typeof c.key === 'number' ? c.key : undefined,
            label: c.label,
            details: c.details,
            dueDate: c.dueDate || null,
            done: c.done,
          })),
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
      <div className="modal modal-wide" role="dialog" ref={modalRef} tabIndex={-1} aria-modal="true" aria-labelledby="sponsor-dialog-title">
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
              <select
                value={form.ownerOther ? OTHER_OWNER : form.ownerId}
                onChange={(e) =>
                  e.target.value === OTHER_OWNER
                    ? setForm((prev) => ({ ...prev, ownerOther: true }))
                    : setForm((prev) => ({ ...prev, ownerOther: false, ownerId: e.target.value }))
                }
              >
                <option value="">— Personne —</option>
                {team.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
                <option value={OTHER_OWNER}>Autre (saisir un nom)…</option>
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
            {form.ownerOther && (
              <label className="span-2">
                Nom du responsable
                <input
                  value={form.ownerName}
                  onChange={update('ownerName')}
                  maxLength={200}
                  placeholder="ex : Camille Martin (pôle Communication)"
                  autoFocus
                  required
                />
              </label>
            )}
            <label>
              {form.contributionType === 'money' ? 'Montant (€)' : 'Valeur estimée (€)'}
              <input type="number" min={0} step="1" value={form.amount} onChange={update('amount')} placeholder="ex : 1500" />
            </label>
            <label>
              Prochaine relance
              <input type="date" value={form.nextActionDate} onChange={update('nextActionDate')} />
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
            <label className="span-2">
              Site web
              <input type="url" value={form.website} onChange={update('website')} placeholder="https://…" maxLength={500} />
            </label>
          </div>

          <fieldset className="form-fieldset">
            <legend>Contacts</legend>
            {form.contacts.length > 0 && (
              <ul className="contact-list">
                {form.contacts.map((c, i) => (
                  <li key={c.key} className="contact-item">
                    <div className="contact-item-head">
                      <span className="contact-item-title">{i === 0 ? 'Contact principal' : `Contact ${i + 1}`}</span>
                      {i > 0 && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => makeMainContact(c.key)}>
                          Mettre en principal
                        </button>
                      )}
                      <button
                        type="button"
                        className="icon-btn icon-btn-danger"
                        onClick={() => removeContact(c.key)}
                        title="Retirer ce contact"
                        aria-label={`Retirer ${c.name || 'ce contact'}`}
                      >
                        ×
                      </button>
                    </div>
                    <div className="form-grid">
                      <label>
                        Nom
                        <input
                          value={c.name}
                          onChange={(e) => updateContact(c.key, { name: e.target.value })}
                          maxLength={200}
                          placeholder="ex : Marie Durand"
                          autoFocus={i > 0 && typeof c.key === 'string' && !hasContent(c)}
                        />
                      </label>
                      <label>
                        Fonction
                        <input
                          value={c.role}
                          onChange={(e) => updateContact(c.key, { role: e.target.value })}
                          maxLength={200}
                          placeholder="ex : Directrice marketing Europe"
                        />
                      </label>
                      <label>
                        Email
                        <input type="email" value={c.email} onChange={(e) => updateContact(c.key, { email: e.target.value })} maxLength={255} />
                      </label>
                      <label>
                        Téléphone
                        <input type="tel" value={c.phone} onChange={(e) => updateContact(c.key, { phone: e.target.value })} maxLength={50} />
                      </label>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="btn btn-outline btn-sm" onClick={addContact}>
              + Ajouter un contact
            </button>
          </fieldset>

          <fieldset className="form-fieldset">
            <legend>Contreparties</legend>
            <p className="muted small counterpart-help">
              Ce qui est promis au partenaire et ses exigences (logo, posts, invitations…). Une échéance dépassée ou dans
              les 7 jours est signalée dans le tableau et dans le menu.
            </p>
            {form.counterparts.length > 0 && (
              <ul className="counterpart-list">
                {form.counterparts.map((c) => {
                  const state = counterpartState(c);
                  return (
                    <li key={c.key} className={`counterpart ${state ? `counterpart-${state}` : ''}`}>
                      <input
                        type="checkbox"
                        className="counterpart-check"
                        checked={c.done}
                        onChange={(e) => updateCounterpart(c.key, { done: e.target.checked, doneAt: null })}
                        title="Fait"
                        aria-label={`Fait : ${c.label || 'contrepartie'}`}
                      />
                      <div className="counterpart-fields">
                        <input
                          value={c.label}
                          onChange={(e) => updateCounterpart(c.key, { label: e.target.value })}
                          maxLength={300}
                          placeholder="ex : Logo sur le capot, 2 posts LinkedIn…"
                          aria-label="Contrepartie"
                          autoFocus={typeof c.key === 'string' && !c.label}
                        />
                        <input
                          value={c.details}
                          onChange={(e) => updateCounterpart(c.key, { details: e.target.value })}
                          maxLength={1000}
                          placeholder="Exigences de la marque, précisions (facultatif)"
                          aria-label="Précisions"
                        />
                      </div>
                      <div className="counterpart-due">
                        <input
                          type="date"
                          value={c.dueDate || ''}
                          onChange={(e) => updateCounterpart(c.key, { dueDate: e.target.value })}
                          title="Échéance (facultative)"
                          aria-label="Échéance"
                        />
                        {state === 'done' ? (
                          <span className="cp-badge cp-done">{c.doneAt ? `Fait le ${formatDate(c.doneAt)}` : 'Fait'}</span>
                        ) : (
                          state && <span className={`cp-badge cp-${state}`}>{COUNTERPART_BADGE[state]}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="icon-btn icon-btn-danger"
                        onClick={() => removeCounterpart(c.key)}
                        title="Retirer"
                        aria-label={`Retirer ${c.label || 'cette contrepartie'}`}
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <button type="button" className="btn btn-outline btn-sm" onClick={addCounterpart}>
              + Ajouter une contrepartie
            </button>
          </fieldset>

          <label>
            Notes
            <textarea
              rows={4}
              value={form.notes}
              onChange={update('notes')}
              maxLength={5000}
              placeholder="Historique des échanges, points d'attention…"
            />
          </label>

          {error && <div role="alert" className="alert alert-error">{error}</div>}
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
