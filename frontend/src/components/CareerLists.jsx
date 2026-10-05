import { formatRank } from '../catalog';
import { formatDate } from '../utils';

// Historique des rôles en frise. `actions(role)` ajoute des boutons à droite (mode édition).
export function RoleTimeline({ roles, actions, highlightId }) {
  if (roles.length === 0) return <p className="muted">Aucun rôle enregistré.</p>;
  return (
    <ol className="timeline">
      {roles.map((role) => (
        <li
          key={role.id}
          className={[role.isCurrent && 'timeline-current', role.id === highlightId && 'item-highlight']
            .filter(Boolean)
            .join(' ')}
        >
          <div className="item-row">
            <div>
              <div className="timeline-title">
                {role.name}
                {role.pole && <span className="timeline-pole"> · {role.pole}</span>}
                {role.isCurrent && <span className="chip chip-current">Actuel</span>}
              </div>
              <div className="muted small">
                {formatDate(role.startDate)} → {role.endDate ? formatDate(role.endDate) : "aujourd'hui"}
              </div>
            </div>
            {actions && <div className="item-actions">{actions(role)}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function CompetitionList({ competitions, actions, highlightId }) {
  if (competitions.length === 0) return <p className="muted">Aucune compétition.</p>;
  return (
    <ul className="competition-list">
      {competitions.map((c) => (
        <li key={c.id} className={c.id === highlightId ? 'item-highlight' : undefined}>
          <div className="competition-main">
            <div className="competition-head">
              <strong>{c.name}</strong>
              <span className="competition-year">{c.year}</span>
              {c.result && <span className="chip chip-rank" title="Classement">{formatRank(c.result)}</span>}
            </div>
            {c.events?.length > 0 && (
              <div className="competition-roles">
                {c.events.map((event) => (
                  <span key={event.name} className="chip">
                    {event.name}
                    {event.rank && <strong className="event-rank"> · {formatRank(event.rank)}</strong>}
                  </span>
                ))}
              </div>
            )}
            {c.comment && <p className="competition-comment">{c.comment}</p>}
          </div>
          {actions && <div className="item-actions">{actions(c)}</div>}
        </li>
      ))}
    </ul>
  );
}

// Boutons ✎ / 🗑 communs aux deux listes
export function ItemActions({ label, onEdit, onDelete, disabled }) {
  return (
    <>
      <button type="button" className="icon-btn" onClick={onEdit} disabled={disabled} title="Modifier" aria-label={`Modifier ${label}`}>
        ✎
      </button>
      <button
        type="button"
        className="icon-btn icon-btn-danger"
        onClick={onDelete}
        disabled={disabled}
        title="Supprimer"
        aria-label={`Supprimer ${label}`}
      >
        ×
      </button>
    </>
  );
}
