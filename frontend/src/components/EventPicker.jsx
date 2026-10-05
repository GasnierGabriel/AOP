import { useState } from 'react';

const sameText = (a, b) => a.toLowerCase() === b.toLowerCase();

// Épreuves préparées : sélection par pastilles (plusieurs possibles), ajout libre,
// et un classement facultatif par épreuve. value = [{ name, rank }]
export default function EventPicker({ value, onChange, presets, max = 12 }) {
  const [custom, setCustom] = useState('');

  const has = (name) => value.some((e) => sameText(e.name, name));
  const add = (name) => !has(name) && value.length < max && onChange([...value, { name, rank: null }]);
  const remove = (name) => onChange(value.filter((e) => !sameText(e.name, name)));
  const toggle = (name) => (has(name) ? remove(name) : add(name));
  const setRank = (name, rank) => onChange(value.map((e) => (sameText(e.name, name) ? { ...e, rank } : e)));

  // Épreuves saisies à la main (hors liste proposée), affichées pour pouvoir les décocher
  const others = value.map((e) => e.name).filter((n) => !presets.some((p) => sameText(p, n)));
  const groups = [
    { label: 'Épreuves', options: presets },
    { label: 'Autres', options: others },
  ].filter((g) => g.options.length > 0);

  const addCustom = () => {
    const name = custom.trim().replace(/\s+/g, ' ');
    if (name) add(name);
    setCustom('');
  };

  return (
    <div className="role-chips">
      {groups.map((group) => (
        <div key={group.label} className="role-group">
          <span className="role-group-label">{group.label}</span>
          <div className="role-group-options">
            {group.options.map((name) => (
              <button
                key={name}
                type="button"
                className={`role-chip ${has(name) ? 'selected' : ''}`}
                aria-pressed={has(name)}
                onClick={() => toggle(name)}
              >
                {has(name) && <span aria-hidden="true">✓ </span>}
                {name}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="role-custom">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder="Autre épreuve…"
          maxLength={60}
          aria-label="Ajouter une autre épreuve"
        />
        <button type="button" className="btn btn-outline btn-sm" onClick={addCustom} disabled={!custom.trim() || value.length >= max}>
          Ajouter
        </button>
      </div>

      {value.length > 0 && (
        <ul className="event-rows">
          {value.map((event) => (
            <li key={event.name} className="event-row">
              <span className="event-row-name">{event.name}</span>
              <label className="event-row-rank">
                <span>Classement</span>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={event.rank ?? ''}
                  onChange={(e) => setRank(event.name, e.target.value === '' ? null : Number(e.target.value))}
                  placeholder="—"
                  aria-label={`Classement à l'épreuve ${event.name} (1 = 1er)`}
                  title="1 = 1er · vide si inconnu"
                />
              </label>
              <button
                type="button"
                className="icon-btn icon-btn-danger"
                onClick={() => remove(event.name)}
                aria-label={`Retirer l'épreuve ${event.name}`}
                title="Retirer"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
