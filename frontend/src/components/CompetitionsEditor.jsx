import { useState } from 'react';
import api, { errorMessage } from '../api';
import { COMPETITION_CHOICES, eventsFor, isAwake } from '../catalog';
import { CompetitionList, ItemActions } from './CareerLists';
import EventPicker from './EventPicker';
import { useConfirm } from './ConfirmProvider';

const OTHER = '__other';

const emptyForm = () => ({
  choice: COMPETITION_CHOICES[0],
  otherName: '',
  year: String(new Date().getFullYear()),
  events: [],
  result: '',
  comment: '',
});

// Compétitions éditables : ajout, modification, suppression
export default function CompetitionsEditor({ memberId, competitions, onChange }) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(null); // null | 'new' | id de l'entrée
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const name = form.choice === OTHER ? form.otherName.trim() : form.choice;
  const awake = isAwake(name);

  const open = (competition) => {
    setError('');
    if (competition) {
      const choice = COMPETITION_CHOICES.find((c) => c.toLowerCase() === competition.name.toLowerCase());
      setEditing(competition.id);
      setForm({
        choice: choice || OTHER,
        otherName: choice ? '' : competition.name,
        year: String(competition.year),
        events: competition.events || [],
        result: competition.result ? String(competition.result) : '',
        comment: competition.comment || '',
      });
    } else {
      setEditing('new');
      setForm(emptyForm());
    }
  };

  const close = () => {
    setEditing(null);
    setError('');
  };

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const request = async (call, fallback) => {
    setBusy(true);
    setError('');
    try {
      const { data } = await call();
      onChange(data.competitions);
      return true;
    } catch (err) {
      setError(errorMessage(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name) return setError('Indique le nom de la compétition');
    const payload = {
      name,
      year: Number(form.year),
      // Challenge Awake : pas d'épreuves, seulement un classement général
      events: awake ? [] : form.events,
      result: awake && form.result ? Number(form.result) : null,
      comment: form.comment,
    };
    const ok = await request(
      () =>
        editing === 'new'
          ? api.post(`/annuaire/members/${memberId}/competitions`, payload)
          : api.patch(`/annuaire/members/${memberId}/competitions/${editing}`, payload),
      "Impossible d'enregistrer la compétition"
    );
    if (ok) close();
  };

  const handleDelete = async (competition) => {
    if (!(await confirm(`Retirer « ${competition.name} ${competition.year} » du parcours ?`, { title: 'Retirer la compétition', confirmLabel: 'Retirer', danger: true }))) return;
    request(
      () => api.delete(`/annuaire/members/${memberId}/competitions/${competition.id}`),
      'Impossible de retirer la compétition'
    ).then((ok) => ok && editing === competition.id && close());
  };

  return (
    <div className="career-editor">
      <CompetitionList
        competitions={competitions}
        highlightId={editing}
        actions={(c) => (
          <ItemActions
            label={`${c.name} ${c.year}`}
            onEdit={() => open(c)}
            onDelete={() => handleDelete(c)}
            disabled={busy}
          />
        )}
      />

      {editing ? (
        <form className="form career-form" onSubmit={handleSubmit}>
          <h3>{editing === 'new' ? 'Ajouter une compétition' : 'Modifier la compétition'}</h3>
          <div className="form-grid">
            <label>
              Compétition
              <select value={form.choice} onChange={(e) => update('choice', e.target.value)} autoFocus>
                {COMPETITION_CHOICES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value={OTHER}>Autre…</option>
              </select>
            </label>
            <label>
              Année
              <input
                type="number"
                value={form.year}
                onChange={(e) => update('year', e.target.value)}
                min={2000}
                max={new Date().getFullYear() + 2}
                required
              />
            </label>
            {form.choice === OTHER && (
              <label className="span-2">
                Nom de la compétition
                <input
                  value={form.otherName}
                  onChange={(e) => update('otherName', e.target.value)}
                  placeholder="Sans l'année, ex : Formula Student Germany"
                  maxLength={200}
                  required
                />
              </label>
            )}
            {awake && (
              <label className="span-2">
                Classement général
                <input
                  type="number"
                  value={form.result}
                  onChange={(e) => update('result', e.target.value)}
                  min={1}
                  max={999}
                  placeholder="1 = 1er · vide si inconnu"
                  title="Classement obtenu (1 = 1er). Laisser vide si la compétition n'a pas encore eu lieu."
                />
              </label>
            )}
          </div>

          {!awake && (
            <div className="field">
              <span className="field-label">Épreuves préparées</span>
              <EventPicker value={form.events} onChange={(events) => update('events', events)} presets={eventsFor(name)} />
            </div>
          )}

          <label>
            Commentaire (facultatif)
            <textarea
              rows={3}
              maxLength={1000}
              value={form.comment}
              onChange={(e) => update('comment', e.target.value)}
              placeholder="Ce que tu as fait, appris, un souvenir marquant…"
            />
          </label>

          {error && <div role="alert" className="alert alert-error">{error}</div>}
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Enregistrer
            </button>
          </div>
        </form>
      ) : (
        <>
          {error && <div role="alert" className="alert alert-error">{error}</div>}
          <button type="button" className="btn btn-outline btn-sm add-btn" onClick={() => open(null)}>
            + Ajouter une compétition
          </button>
        </>
      )}
    </div>
  );
}
