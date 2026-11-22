import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api, { errorMessage } from '../api';
import StatusBadge from '../components/StatusBadge';
import TagList from '../components/TagList';
import TagPicker from '../components/TagPicker';
import TagPill from '../components/TagPill';
import { formatRank } from '../catalog';
import { initials } from '../utils';

const FILTERS = [
  { key: 'all', label: 'Tous' },
  { key: 'active', label: 'Actifs' },
  { key: 'alumni', label: 'Alumni' },
  { key: 'honorary', label: 'Honoraires' },
];

const COLUMNS = [
  { key: 'name', label: 'Membre', sortable: true },
  { key: 'status', label: 'Statut', sortable: true },
  { key: 'promo', label: 'Promo', sortable: true, defaultDir: 'desc' }, // plus récente d'abord
  { key: 'role', label: 'Rôle actuel', sortable: true },
  { key: 'tags', label: 'Tags' },
  { key: 'competitions', label: 'Compétitions' },
  { key: 'linkedin', label: '', srLabel: 'LinkedIn' },
];

const collator = new Intl.Collator('fr', { sensitivity: 'base' });
const byName = (a, b) => collator.compare(a.fullName, b.fullName);
const STATUS_ORDER = { active: 0, honorary: 1, alumni: 2, prospect: 3 };

// Valeur triée pour les colonnes où elle peut manquer (toujours en fin de liste)
const OPTIONAL_VALUES = {
  promo: (m) => m.promo ?? null,
  role: (m) => m.currentRoles[0]?.name ?? null,
};

function sortMembers(list, key, dir) {
  const sign = dir === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => {
    if (OPTIONAL_VALUES[key]) {
      const va = OPTIONAL_VALUES[key](a);
      const vb = OPTIONAL_VALUES[key](b);
      if (va === null || vb === null) return va === vb ? byName(a, b) : va === null ? 1 : -1;
      const diff = typeof va === 'number' ? va - vb : collator.compare(va, vb);
      return sign * diff || byName(a, b);
    }
    if (key === 'status') {
      // Bureau en tête, puis actifs, honoraires, alumni, prospects
      const diff = b.isBureau - a.isBureau || STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      return sign * diff || byName(a, b);
    }
    return sign * byName(a, b);
  });
}

// « Formula Student UK 2026 » → « FSUK 26 » pour tenir dans la colonne
const COMPETITION_SHORT = { 'formula student uk': 'FSUK', 'formula student france': 'FSF', 'challenge awake': 'Awake' };
const shortCompetition = (c) =>
  `${COMPETITION_SHORT[c.name.toLowerCase()] || c.name} ${String(c.year).slice(2)}${c.result ? ` ${formatRank(c.result)}` : ''}`;
const competitionDetail = (c) =>
  [`${c.name} ${c.year}`, ...(c.events || []).map((e) => `${e.name}${e.rank ? ` (${e.rank}e)` : ''}`)].join(' · ');

function SortHeader({ column, sortKey, sortDir, onSort }) {
  if (!column.sortable) {
    return (
      <th scope="col" className={`col-${column.key}`}>
        {column.label || <span className="sr-only">{column.srLabel}</span>}
      </th>
    );
  }
  const active = sortKey === column.key;
  return (
    <th
      scope="col"
      className={`col-${column.key}`}
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button type="button" className={`sort-button ${active ? 'is-active' : ''}`} onClick={() => onSort(column)}>
        {column.label}
        <span className="sort-arrow" aria-hidden="true">
          {active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );
}

function MemberRow({ member }) {
  const navigate = useNavigate();
  const shown = member.competitions.slice(0, 2);
  const hidden = member.competitions.length - shown.length;

  return (
    <tr className="member-row" onClick={() => navigate(`/member/${member.id}`)}>
      <td className="col-name">
        <div className="member-cell">
          <div className="avatar avatar-sm">{initials(member.fullName)}</div>
          <Link to={`/member/${member.id}`} onClick={(e) => e.stopPropagation()}>
            {member.fullName}
          </Link>
        </div>
      </td>
      <td className="col-status">
        <StatusBadge status={member.status} isBureau={member.isBureau} />
      </td>
      <td className={`col-promo ${member.promo ? '' : 'is-empty'}`}>
        <span className="cell-prefix">Promo </span>
        {member.promo || <span className="muted">—</span>}
      </td>
      <td className={`col-role ${member.currentRoles.length ? '' : 'is-empty'}`}>
        {member.currentRoles.length > 0 ? (
          <div className="cell-chips">
            {member.currentRoles.map((role) => (
              <span key={role.id} className="chip chip-primary" title={role.pole || undefined}>
                {role.name}
              </span>
            ))}
          </div>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td className={`col-tags ${member.tags.length ? '' : 'is-empty'}`}>
        <TagList tags={member.tags} />
      </td>
      <td className={`col-competitions ${member.competitions.length ? '' : 'is-empty'}`}>
        <div className="cell-chips">
          {shown.map((c) => (
            <span key={c.id} className="chip" title={competitionDetail(c)}>
              {shortCompetition(c)}
            </span>
          ))}
          {hidden > 0 && (
            <span className="chip" title={member.competitions.slice(2).map(competitionDetail).join('\n')}>
              +{hidden}
            </span>
          )}
        </div>
      </td>
      <td className="col-linkedin">
        {member.linkedinUrl && (
          <a
            href={member.linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            aria-label={`LinkedIn de ${member.fullName}`}
            title="LinkedIn"
            className="linkedin-icon"
          >
            in
          </a>
        )}
      </td>
    </tr>
  );
}

export default function Annuaire() {
  const [members, setMembers] = useState([]);
  const [academicYear, setAcademicYear] = useState('');
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filtres et tri dans l'URL : conservés au retour d'une fiche, et partageables
  const [params, setParams] = useSearchParams();
  const search = params.get('q') || '';
  const filter = params.get('statut') || 'all';
  const tagFilter = params.get('tag') ? Number(params.get('tag')) : null;
  const promoFilter = params.get('promo') || '';
  const sortKey = params.get('tri') || 'name';
  const sortDir = params.get('ordre') || 'asc';

  const updateParams = (changes) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '' || value === undefined) next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };

  useEffect(() => {
    api
      .get('/annuaire/members')
      .then(({ data }) => {
        setMembers(data.members);
        setAcademicYear(data.academicYear);
      })
      .catch((err) => setError({ pending: err.response?.data?.code === 'PENDING_VALIDATION', message: errorMessage(err) }))
      .finally(() => setLoading(false));
  }, []);

  const counts = useMemo(() => {
    const result = { all: members.length };
    for (const m of members) result[m.status] = (result[m.status] || 0) + 1;
    return result;
  }, [members]);

  // Tags présents parmi les membres visibles (avec leur nombre), pour le filtre
  const availableTags = useMemo(() => {
    const byId = new Map();
    for (const m of members) {
      for (const t of m.tags) {
        const entry = byId.get(t.id) || { ...t, memberCount: 0 };
        entry.memberCount += 1;
        byId.set(t.id, entry);
      }
    }
    return [...byId.values()].sort((a, b) => collator.compare(a.name, b.name));
  }, [members]);
  const selectedTag = availableTags.find((t) => t.id === tagFilter);

  // Promos présentes parmi les membres visibles, de la plus récente à la plus ancienne
  const availablePromos = useMemo(
    () => [...new Set(members.map((m) => m.promo).filter(Boolean))].sort((a, b) => b - a),
    [members]
  );

  const visibleMembers = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = members.filter(
      (m) =>
        (filter === 'all' || m.status === filter) &&
        (!tagFilter || m.tags.some((t) => t.id === tagFilter)) &&
        (!promoFilter || m.promo === Number(promoFilter)) &&
        (!term ||
          m.fullName.toLowerCase().includes(term) ||
          m.currentRoles.some((r) => r.name.toLowerCase().includes(term)) ||
          m.tags.some((t) => t.name.toLowerCase().includes(term)))
    );
    return sortMembers(filtered, sortKey, sortDir);
  }, [members, filter, tagFilter, promoFilter, search, sortKey, sortDir]);

  const hasFilters = Boolean(search || filter !== 'all' || tagFilter || promoFilter);

  const handleSort = (column) => {
    if (sortKey === column.key) updateParams({ ordre: sortDir === 'asc' ? 'desc' : 'asc' });
    else updateParams({ tri: column.key === 'name' ? null : column.key, ordre: column.defaultDir || null });
  };

  if (loading) return <div className="loading" role="status">Chargement de l'annuaire…</div>;

  if (error?.pending) {
    return (
      <div className="card empty-state">
        <h2>⏳ Compte en attente de validation</h2>
        <p>Le bureau doit valider ton inscription avant que tu puisses accéder à l'annuaire.</p>
        <p className="muted">En attendant, tu peux compléter ton profil.</p>
      </div>
    );
  }
  if (error) return <div role="alert" className="alert alert-error">{error.message}</div>;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Annuaire</h1>
          {academicYear && <p className="muted">Année {academicYear}</p>}
        </div>
        <input
          type="search"
          className="search"
          aria-label="Rechercher dans l’annuaire"
          placeholder="Rechercher un nom, un rôle, un tag…"
          value={search}
          onChange={(e) => updateParams({ q: e.target.value })}
        />
      </div>

      <div className="filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`filter ${filter === f.key ? 'filter-active' : ''}`}
            onClick={() => updateParams({ statut: f.key === 'all' ? null : f.key })}
          >
            {f.label} <span className="filter-count">{counts[f.key] || 0}</span>
          </button>
        ))}
        {availableTags.length > 0 && (
          <div className="tag-anchor">
            {selectedTag ? (
              <span className="filter filter-tag-selected">
                <button type="button" className="filter-tag-open" onClick={() => setTagPickerOpen((o) => !o)}>
                  <TagPill tag={selectedTag} />
                </button>
                <button
                  type="button"
                  className="filter-tag-clear"
                  onClick={() => updateParams({ tag: null })}
                  aria-label="Retirer le filtre de tag"
                  title="Retirer le filtre"
                >
                  ×
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="filter"
                onClick={() => setTagPickerOpen((o) => !o)}
                aria-expanded={tagPickerOpen}
              >
                Tags ▾
              </button>
            )}
            {tagPickerOpen && (
              <TagPicker
                options={availableTags}
                selectedIds={new Set(tagFilter ? [tagFilter] : [])}
                onSelect={(tag) => {
                  updateParams({ tag: tag.id === tagFilter ? null : tag.id });
                  setTagPickerOpen(false);
                }}
                onClose={() => setTagPickerOpen(false)}
                placeholder="Filtrer par tag"
              />
            )}
          </div>
        )}
        {availablePromos.length > 0 && (
          <select
            className={`filter promo-filter ${promoFilter ? 'filter-active' : ''}`}
            value={promoFilter}
            onChange={(e) => updateParams({ promo: e.target.value })}
            aria-label="Filtrer par promo"
          >
            <option value="">Toutes les promos</option>
            {availablePromos.map((promo) => (
              <option key={promo} value={promo}>
                Promo {promo}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="results-bar">
        {/* Nombre de résultats annoncé aux lecteurs d'écran quand la recherche ou les filtres changent */}
        <span className="muted" role="status">
          {visibleMembers.length} membre{visibleMembers.length > 1 ? 's' : ''}
          {hasFilters && ` sur ${members.length}`}
        </span>
        <div className="results-actions">
          {hasFilters && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => updateParams({ q: null, statut: null, tag: null, promo: null })}
            >
              Réinitialiser les filtres
            </button>
          )}
          {/* Sur mobile les en-têtes de colonnes sont masqués : le tri passe par cette liste */}
          <label className="mobile-sort">
            Trier
            <select
              value={`${sortKey}:${sortDir}`}
              onChange={(e) => {
                const [tri, ordre] = e.target.value.split(':');
                updateParams({ tri: tri === 'name' ? null : tri, ordre: ordre === 'asc' ? null : ordre });
              }}
            >
              <option value="name:asc">Nom (A → Z)</option>
              <option value="name:desc">Nom (Z → A)</option>
              <option value="status:asc">Statut</option>
              <option value="promo:desc">Promo (récentes)</option>
              <option value="promo:asc">Promo (anciennes)</option>
              <option value="role:asc">Rôle actuel</option>
            </select>
          </label>
        </div>
      </div>

      {visibleMembers.length === 0 ? (
        <p className="muted empty-state">Aucun membre ne correspond.</p>
      ) : (
        <div className="card directory">
          <table className="directory-table">
            <caption className="sr-only">Membres de l’annuaire ({visibleMembers.length})</caption>
            <thead>
              <tr>
                {COLUMNS.map((column) => (
                  <SortHeader key={column.key} column={column} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleMembers.map((m) => (
                <MemberRow key={m.id} member={m} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
