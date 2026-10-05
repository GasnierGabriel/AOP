import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errorMessage } from '../api';
import DeleteMemberDialog from '../components/DeleteMemberDialog';
import StatusBadge from '../components/StatusBadge';
import { formatDate, initials } from '../utils';

const STATUS_OPTIONS = [
  ['prospect', 'Prospect'],
  ['active', 'Membre actif'],
  ['alumni', 'Alumni'],
  ['honorary', 'Honoraire'],
];

const FILTERS = [
  ['all', 'Tous'],
  ['prospect', 'Prospects'],
  ['active', 'Actifs'],
  ['alumni', 'Alumni'],
  ['honorary', 'Honoraires'],
  ['bureau', 'Bureau'],
];

// Ce que donne chaque niveau selon le statut (règles de canViewUser / getAskAreceAccess côté API)
const LEVEL_HELP = {
  active: { 1: "Bureau + actifs de l'année · Ask ARECE limité", 2: 'Annuaire complet · Ask ARECE limité' },
  alumni: { 1: 'Alumni uniquement · pas d’Ask ARECE', 2: 'Annuaire complet · Ask ARECE limité' },
  honorary: { 1: 'Son profil uniquement · pas d’Ask ARECE', 2: 'Annuaire complet · Ask ARECE limité' },
  prospect: { 1: 'Aucun accès', 2: 'Aucun accès' },
};

function accessSummary(member) {
  if (member.isBureau) return 'Accès complet (bureau) · Ask ARECE complet';
  return LEVEL_HELP[member.status]?.[member.level] || '';
}

// Gestion des accès, réservée au bureau : validation des inscriptions, statut, bureau, niveau
export default function Gestion({ session, onSessionChange }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [saving, setSaving] = useState({}); // id -> true pendant l'enregistrement
  const [rowState, setRowState] = useState({}); // id -> { saved } | { error }
  const [toDelete, setToDelete] = useState(null); // membre dont la suppression est en cours de confirmation

  useEffect(() => {
    api
      .get('/annuaire/members')
      .then(({ data }) => setMembers(data.members))
      .catch((err) => setError(errorMessage(err, 'Impossible de charger les membres')))
      .finally(() => setLoading(false));
  }, []);

  const prospects = members.filter((m) => m.status === 'prospect');

  const counts = useMemo(() => {
    const result = { all: members.length, bureau: members.filter((m) => m.isBureau).length };
    for (const m of members) result[m.status] = (result[m.status] || 0) + 1;
    return result;
  }, [members]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return members.filter(
      (m) =>
        (filter === 'all' || (filter === 'bureau' ? m.isBureau : m.status === filter)) &&
        (!term || m.fullName.toLowerCase().includes(term) || m.email.toLowerCase().includes(term))
    );
  }, [members, filter, search]);

  const updateAccess = async (member, changes) => {
    const isSelf = member.id === session?.user.id;
    if (isSelf && changes.isBureau === false) {
      if (!window.confirm("Tu vas retirer ton propre accès bureau : tu ne pourras plus gérer les membres. Continuer ?")) {
        return;
      }
    }

    setSaving((s) => ({ ...s, [member.id]: true }));
    setRowState((s) => ({ ...s, [member.id]: null }));
    try {
      const { data } = await api.patch(`/annuaire/members/${member.id}/access`, changes);
      setMembers((list) => list.map((m) => (m.id === member.id ? { ...m, ...data.member } : m)));
      setRowState((s) => ({ ...s, [member.id]: { saved: true } }));
      setTimeout(() => setRowState((s) => (s[member.id]?.saved ? { ...s, [member.id]: null } : s)), 2000);
      onSessionChange(); // compteur d'inscriptions en attente, ou perte de ses propres droits
    } catch (err) {
      setRowState((s) => ({ ...s, [member.id]: { error: errorMessage(err, 'Échec de la modification') } }));
    } finally {
      setSaving((s) => ({ ...s, [member.id]: false }));
    }
  };

  // Suppression définitive (les erreurs remontent à l'appelant)
  const deleteMember = async (member) => {
    await api.delete(`/annuaire/members/${member.id}`);
    setMembers((list) => list.filter((m) => m.id !== member.id));
    onSessionChange();
  };

  // Refus d'une inscription : simple confirmation, le compte n'a encore aucun historique
  const refuse = async (member) => {
    if (!window.confirm(`Refuser l'inscription de ${member.fullName} ? Son compte sera supprimé définitivement.`)) return;
    setSaving((s) => ({ ...s, [member.id]: true }));
    try {
      await deleteMember(member);
    } catch (err) {
      setRowState((s) => ({ ...s, [member.id]: { error: errorMessage(err, 'Impossible de supprimer ce compte') } }));
      setSaving((s) => ({ ...s, [member.id]: false }));
    }
  };

  const deleteBlockedReason = (member) => {
    if (member.id === session?.user.id) return 'Tu ne peux pas supprimer ton propre compte';
    if (member.isBureau) return "Retire d'abord ce membre du bureau";
    return null;
  };

  if (loading) return <div className="loading">Chargement…</div>;
  if (error) return <div className="alert alert-error">{error}</div>;

  return (
    <div className="gestion">
      <div className="page-header">
        <div>
          <h1>Gestion des membres</h1>
          <p className="muted">Statuts, bureau et niveaux d'accès · visible uniquement par le bureau</p>
        </div>
      </div>

      {prospects.length > 0 && (
        <section className="card pending">
          <h2>Inscriptions en attente ({prospects.length})</h2>
          <ul className="pending-list">
            {prospects.map((m) => (
              <li key={m.id} className="pending-item">
                <div className="avatar">{initials(m.fullName)}</div>
                <div className="pending-identity">
                  <Link to={`/member/${m.id}`} className="pending-name">
                    {m.fullName}
                  </Link>
                  <span className="muted small">
                    {m.email} · inscrit le {formatDate(m.createdAt)}
                    {m.linkedinUrl && (
                      <>
                        {' · '}
                        <a href={m.linkedinUrl} target="_blank" rel="noopener noreferrer">
                          LinkedIn ↗
                        </a>
                      </>
                    )}
                  </span>
                  {rowState[m.id]?.error && <span className="row-error">{rowState[m.id].error}</span>}
                </div>
                <div className="pending-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={saving[m.id]}
                    onClick={() => updateAccess(m, { status: 'active', level: 1 })}
                  >
                    Valider · membre actif
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    disabled={saving[m.id]}
                    onClick={() => updateAccess(m, { status: 'alumni', level: 1 })}
                  >
                    Alumni
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={saving[m.id]}
                    onClick={() => refuse(m)}
                  >
                    Refuser
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="gestion-toolbar">
        <div className="filters">
          {FILTERS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`filter ${filter === key ? 'filter-active' : ''}`}
              onClick={() => setFilter(key)}
            >
              {label} <span className="filter-count">{counts[key] || 0}</span>
            </button>
          ))}
        </div>
        <input
          type="search"
          className="search"
          placeholder="Rechercher un nom, un email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card access-table" role="table" aria-label="Accès des membres">
        <div className="access-row access-head" role="row">
          <span role="columnheader">Membre</span>
          <span role="columnheader">Statut</span>
          <span role="columnheader">Bureau</span>
          <span role="columnheader">Niveau</span>
        </div>
        {visible.length === 0 && <p className="muted empty-state">Aucun membre ne correspond.</p>}
        {visible.map((m) => (
          <div key={m.id} className={`access-row ${saving[m.id] ? 'is-saving' : ''}`} role="row">
            <div className="access-member" role="cell">
              <div className="avatar">{initials(m.fullName)}</div>
              <div className="access-identity">
                <Link to={`/member/${m.id}`}>{m.fullName}</Link>
                {m.id === session?.user.id && <span className="chip chip-you">Toi</span>}
                <span className="muted small">{m.email}</span>
                <span className="access-summary">{accessSummary(m)}</span>
                {rowState[m.id]?.error && <span className="row-error">{rowState[m.id].error}</span>}
              </div>
            </div>

            <label className="access-cell" role="cell">
              <span className="access-label">Statut</span>
              <select
                value={m.status}
                disabled={saving[m.id]}
                onChange={(e) => updateAccess(m, { status: e.target.value })}
                aria-label={`Statut de ${m.fullName}`}
              >
                {STATUS_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value} disabled={value === 'prospect' && m.isBureau}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="access-cell access-check" role="cell">
              <span className="access-label">Bureau</span>
              <input
                type="checkbox"
                checked={m.isBureau}
                disabled={saving[m.id] || (m.status === 'prospect' && !m.isBureau)}
                onChange={(e) => updateAccess(m, { isBureau: e.target.checked })}
                aria-label={`${m.fullName} membre du bureau`}
                title={m.status === 'prospect' ? "Valide d'abord l'inscription" : undefined}
              />
            </label>

            <label className="access-cell" role="cell">
              <span className="access-label">Niveau</span>
              <select
                value={m.level}
                disabled={saving[m.id] || m.isBureau}
                onChange={(e) => updateAccess(m, { level: Number(e.target.value) })}
                aria-label={`Niveau d'accès de ${m.fullName}`}
                title={m.isBureau ? 'Le bureau a un accès complet, quel que soit le niveau' : undefined}
              >
                <option value={1}>Niveau 1</option>
                <option value={2}>Niveau 2</option>
              </select>
            </label>

            <div className="access-state" role="cell">
              <span className="access-feedback" aria-live="polite">
                {saving[m.id] && <span className="muted small">…</span>}
                {rowState[m.id]?.saved && <span className="row-saved" title="Enregistré">✓</span>}
              </span>
              <button
                type="button"
                className="icon-btn icon-btn-danger"
                onClick={() => setToDelete(m)}
                disabled={saving[m.id] || Boolean(deleteBlockedReason(m))}
                title={deleteBlockedReason(m) || 'Supprimer le compte'}
                aria-label={`Supprimer le compte de ${m.fullName}`}
              >
                🗑
              </button>
            </div>
          </div>
        ))}
      </div>

      {toDelete && (
        <DeleteMemberDialog
          member={toDelete}
          onConfirm={async () => {
            await deleteMember(toDelete);
            setToDelete(null);
          }}
          onClose={() => setToDelete(null)}
        />
      )}

      <details className="card access-legend">
        <summary>Rappel des niveaux d'accès</summary>
        <table>
          <thead>
            <tr>
              <th>Statut</th>
              <th>Niveau 1</th>
              <th>Niveau 2</th>
            </tr>
          </thead>
          <tbody>
            {STATUS_OPTIONS.filter(([s]) => s !== 'prospect').map(([status, label]) => (
              <tr key={status}>
                <td>
                  <StatusBadge status={status} />
                  <span className="sr-only">{label}</span>
                </td>
                <td>{LEVEL_HELP[status][1]}</td>
                <td>{LEVEL_HELP[status][2]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          Bureau : accès complet, quel que soit le niveau. Prospect : aucun accès tant que l'inscription n'est pas validée.
          Ask ARECE limité = sans le dossier « bureau » du Drive.
        </p>
      </details>
    </div>
  );
}
