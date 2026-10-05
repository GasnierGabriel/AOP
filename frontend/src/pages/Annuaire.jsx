import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

function MemberCard({ member }) {
  const navigate = useNavigate();
  const open = () => navigate(`/member/${member.id}`);

  return (
    <div
      className="card member-card"
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => e.key === 'Enter' && open()}
    >
      <div className="member-card-header">
        <div className="avatar">{initials(member.fullName)}</div>
        <div>
          <h3>{member.fullName}</h3>
          <StatusBadge status={member.status} isBureau={member.isBureau} />
        </div>
      </div>

      {member.promo && <p className="muted small">Promo {member.promo}</p>}

      {member.currentRoles.length > 0 && (
        <div className="chips">
          {member.currentRoles.map((role) => (
            <span key={role.id} className="chip chip-primary">
              {role.name}
              {role.pole ? ` · ${role.pole}` : ''}
            </span>
          ))}
        </div>
      )}

      <TagList tags={member.tags} />

      {member.competitions.length > 0 && (
        <div className="chips">
          {member.competitions.map((c) => (
            <span key={c.id} className="chip" title={c.events?.map((e) => e.name).join(', ') || undefined}>
              🏁 {c.name} {c.year}
              {c.result && ` · ${formatRank(c.result)}`}
            </span>
          ))}
        </div>
      )}

      {member.linkedinUrl && (
        <a
          className="linkedin-link"
          href={member.linkedinUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          LinkedIn ↗
        </a>
      )}
    </div>
  );
}

export default function Annuaire() {
  const [members, setMembers] = useState([]);
  const [academicYear, setAcademicYear] = useState('');
  const [filter, setFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState(null); // id du tag filtré
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [promoFilter, setPromoFilter] = useState(''); // '' = toutes les promos
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  }, [members]);
  const selectedTag = availableTags.find((t) => t.id === tagFilter);

  // Promos présentes parmi les membres visibles, de la plus récente à la plus ancienne
  const availablePromos = useMemo(
    () => [...new Set(members.map((m) => m.promo).filter(Boolean))].sort((a, b) => b - a),
    [members]
  );

  const visibleMembers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return members.filter(
      (m) =>
        (filter === 'all' || m.status === filter) &&
        (!tagFilter || m.tags.some((t) => t.id === tagFilter)) &&
        (!promoFilter || m.promo === Number(promoFilter)) &&
        (!term ||
          m.fullName.toLowerCase().includes(term) ||
          m.currentRoles.some((r) => r.name.toLowerCase().includes(term)) ||
          m.tags.some((t) => t.name.toLowerCase().includes(term)))
    );
  }, [members, filter, tagFilter, promoFilter, search]);

  if (loading) return <div className="loading">Chargement de l'annuaire…</div>;

  if (error?.pending) {
    return (
      <div className="card empty-state">
        <h2>⏳ Compte en attente de validation</h2>
        <p>Le bureau doit valider ton inscription avant que tu puisses accéder à l'annuaire.</p>
        <p className="muted">En attendant, tu peux compléter ton profil.</p>
      </div>
    );
  }
  if (error) return <div className="alert alert-error">{error.message}</div>;

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
          placeholder="Rechercher un nom, un rôle, un tag…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`filter ${filter === f.key ? 'filter-active' : ''}`}
            onClick={() => setFilter(f.key)}
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
                  onClick={() => setTagFilter(null)}
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
                  setTagFilter(tag.id === tagFilter ? null : tag.id);
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
            onChange={(e) => setPromoFilter(e.target.value)}
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

      {visibleMembers.length === 0 ? (
        <p className="muted empty-state">Aucun membre ne correspond.</p>
      ) : (
        <div className="grid">
          {visibleMembers.map((m) => (
            <MemberCard key={m.id} member={m} />
          ))}
        </div>
      )}
    </>
  );
}
