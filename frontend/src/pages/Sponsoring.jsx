import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { errorMessage } from '../api';
import SponsorDialog from '../components/SponsorDialog';
import TagPill from '../components/TagPill';
import TiersDialog from '../components/TiersDialog';
import {
  CONTRIBUTION_LABEL,
  SPONSOR_STATUSES,
  STATUS_ORDER,
  counterpartSummary,
  followUpState,
  formatEuro,
  ownerLabel,
} from '../sponsoringConfig';
import { formatDate } from '../utils';

const collator = new Intl.Collator('fr', { sensitivity: 'base' });
const byName = (a, b) => collator.compare(a.name, b.name);

const COLUMNS = [
  { key: 'name', label: 'Partenaire' },
  { key: 'status', label: 'Statut' },
  { key: 'tier', label: 'Rang', defaultDir: 'desc' }, // rang le plus élevé d'abord
  { key: 'amount', label: 'Apport', defaultDir: 'desc' },
  { key: 'owner', label: 'Responsable' },
  { key: 'counterparts', label: 'Contreparties' }, // prochaine échéance d'abord
  { key: 'followUp', label: 'Relance' },
];

// Valeurs triées pouvant manquer (toujours en fin de liste)
const OPTIONAL_VALUES = {
  tier: (s) => s.tier?.position ?? null,
  amount: (s) => s.amount,
  owner: ownerLabel,
  counterparts: (s) => counterpartSummary(s).next,
  followUp: (s) => s.nextActionDate || null,
};

function sortSponsors(list, key, dir) {
  const sign = dir === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => {
    if (OPTIONAL_VALUES[key]) {
      const va = OPTIONAL_VALUES[key](a);
      const vb = OPTIONAL_VALUES[key](b);
      if (va === null || vb === null) return va === vb ? byName(a, b) : va === null ? 1 : -1;
      const diff = typeof va === 'number' ? va - vb : collator.compare(va, vb);
      return sign * diff || byName(a, b);
    }
    if (key === 'status') return sign * (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || byName(a, b);
    return sign * byName(a, b);
  });
}

const sum = (list) => list.reduce((total, s) => total + (s.amount || 0), 0);

// Indicateur de la colonne Contreparties : le plus urgent d'abord
function CounterpartCell({ summary }) {
  if (summary.overdue) return <span className="cp-badge cp-overdue">⚠ {summary.overdue} en retard</span>;
  if (summary.today) return <span className="cp-badge cp-today">Aujourd'hui</span>;
  if (summary.soon) return <span className="cp-badge cp-soon">{formatDate(summary.next)}</span>;
  return summary.next ? <span className="muted small">{formatDate(summary.next)}</span> : null;
}

export default function Sponsoring({ session, onSessionChange }) {
  const [sponsors, setSponsors] = useState([]);
  const [team, setTeam] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rowError, setRowError] = useState('');
  const [dialog, setDialog] = useState(null); // null | {} (nouveau) | partenaire (+ presetStatus)
  const [tiersOpen, setTiersOpen] = useState(false);

  // Filtres et tri dans l'URL, comme l'annuaire
  const [params, setParams] = useSearchParams();
  const search = params.get('q') || '';
  const statusFilter = params.get('statut') || 'all';
  const ownerFilter = params.get('resp') || '';
  const tierFilter = params.get('rang') || '';
  const urgentFilter = params.get('contreparties') === 'urgent';
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

  const loadAll = () =>
    Promise.all([api.get('/sponsoring/sponsors'), api.get('/sponsoring/team'), api.get('/sponsoring/tiers')])
      .then(([s, t, r]) => {
        setSponsors(s.data.sponsors);
        setTeam(t.data.team);
        setTiers(r.data.tiers);
      })
      .catch((err) => setError(errorMessage(err, 'Impossible de charger les partenaires')))
      .finally(() => setLoading(false));

  useEffect(() => {
    loadAll();
  }, []);

  const myId = session?.user.id;
  const counts = useMemo(() => {
    const result = { all: sponsors.length };
    for (const s of sponsors) result[s.status] = (result[s.status] || 0) + 1;
    return result;
  }, [sponsors]);

  const totals = useMemo(
    () => ({
      signed: sum(sponsors.filter((s) => s.status === 'signed')),
      negotiation: sum(sponsors.filter((s) => s.status === 'negotiation')),
      overdue: sponsors.filter((s) => followUpState(s) === 'overdue').length,
      // Contreparties non faites en retard, du jour ou sous 7 jours
      counterpartsUrgent: sponsors.reduce((n, s) => n + counterpartSummary(s).urgent, 0),
      counterpartsOverdue: sponsors.reduce((n, s) => n + counterpartSummary(s).overdue, 0),
      // Répartition des signés par rang, du plus élevé au plus bas : « 2 Or · 1 Bronze »
      signedByTier: tiers
        .map((t) => ({ name: t.name, position: t.position, n: sponsors.filter((s) => s.status === 'signed' && s.tier?.id === t.id).length }))
        .filter((t) => t.n > 0)
        .sort((a, b) => b.position - a.position)
        .map((t) => `${t.n} ${t.name}`)
        .join(' · '),
    }),
    [sponsors, tiers]
  );

  // Responsables saisis à la main (hors équipe), proposés dans le filtre
  const externalOwners = useMemo(
    () => [...new Set(sponsors.map((s) => s.ownerExternal).filter(Boolean))].sort(collator.compare),
    [sponsors]
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const matchesOwner = (s) => {
      if (!ownerFilter) return true;
      if (ownerFilter === 'none') return !ownerLabel(s);
      if (ownerFilter.startsWith('ext:')) return s.ownerExternal === ownerFilter.slice(4);
      return s.owner?.id === (ownerFilter === 'me' ? myId : Number(ownerFilter));
    };
    const matchesTerm = (s) =>
      [
        s.name,
        s.contributionDetails,
        s.ownerExternal,
        ...s.contacts.flatMap((c) => [c.name, c.role, c.email]),
        ...s.counterparts.map((c) => c.label),
      ].some(
        (text) => text && text.toLowerCase().includes(term)
      );
    const filtered = sponsors.filter(
      (s) =>
        (statusFilter === 'all' || s.status === statusFilter) &&
        (!tierFilter || (tierFilter === 'none' ? !s.tier : s.tier?.id === Number(tierFilter))) &&
        matchesOwner(s) &&
        (!urgentFilter || counterpartSummary(s).urgent > 0) &&
        (!term || matchesTerm(s))
    );
    return sortSponsors(filtered, sortKey, sortDir);
  }, [sponsors, statusFilter, tierFilter, ownerFilter, urgentFilter, search, sortKey, sortDir, myId]);

  const hasFilters = Boolean(search || statusFilter !== 'all' || ownerFilter || tierFilter || urgentFilter);

  const replaceSponsor = (sponsor) => setSponsors((list) => list.map((s) => (s.id === sponsor.id ? sponsor : s)));

  const changeStatus = async (sponsor, status) => {
    setRowError('');
    // Signé sans rang : on ouvre la fiche pour le choisir (obligatoire)
    if (status === 'signed' && !sponsor.tier) {
      setDialog({ ...sponsor, presetStatus: 'signed' });
      return;
    }
    try {
      const { data } = await api.patch(`/sponsoring/sponsors/${sponsor.id}`, { status });
      replaceSponsor(data.sponsor);
    } catch (err) {
      setRowError(errorMessage(err, 'Impossible de changer le statut'));
    }
  };

  const saveSponsor = async (values) => {
    if (dialog?.id) {
      const { data } = await api.patch(`/sponsoring/sponsors/${dialog.id}`, values);
      replaceSponsor(data.sponsor);
    } else {
      const { data } = await api.post('/sponsoring/sponsors', values);
      setSponsors((list) => [...list, data.sponsor]);
    }
    setDialog(null);
    onSessionChange?.(); // badge des contreparties à échéance dans le menu
  };

  const createTier = async (values) => {
    const { data } = await api.post('/sponsoring/tiers', values);
    setTiers((list) => [...list, data.tier]);
    return data.tier;
  };

  const deleteSponsor = async () => {
    await api.delete(`/sponsoring/sponsors/${dialog.id}`);
    setSponsors((list) => list.filter((s) => s.id !== dialog.id));
    setDialog(null);
    onSessionChange?.();
  };

  const handleSort = (column) => {
    if (sortKey === column.key) updateParams({ ordre: sortDir === 'asc' ? 'desc' : 'asc' });
    else updateParams({ tri: column.key === 'name' ? null : column.key, ordre: column.defaultDir || null });
  };

  if (loading) return <div className="loading">Chargement…</div>;
  if (error) return <div className="alert alert-error">{error}</div>;

  return (
    <div className="sponsoring">
      <div className="page-header">
        <div>
          <h1>Sponsoring</h1>
          <p className="muted">Suivi des partenaires · bureau et pôle Sponsoring</p>
        </div>
        <div className="wiki-header-actions">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setTiersOpen(true)}>
            Rangs
          </button>
          <button type="button" className="btn btn-light" onClick={() => setDialog({})}>
            + Nouveau partenaire
          </button>
        </div>
      </div>

      <div className="sponsor-kpis">
        <div className="kpi">
          <span className="kpi-label">Signé</span>
          <strong className="kpi-value">{formatEuro(totals.signed) || '0 €'}</strong>
          <span className="kpi-sub">
            {counts.signed || 0} partenaire{(counts.signed || 0) > 1 ? 's' : ''}
            {totals.signedByTier && ` · ${totals.signedByTier}`}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">En négociation</span>
          <strong className="kpi-value">{formatEuro(totals.negotiation) || '0 €'}</strong>
          <span className="kpi-sub">{counts.negotiation || 0} en cours</span>
        </div>
        <div className={`kpi ${totals.overdue ? 'kpi-alert' : ''}`}>
          <span className="kpi-label">Relances en retard</span>
          <strong className="kpi-value">{totals.overdue}</strong>
          <span className="kpi-sub">{totals.overdue ? 'à traiter' : 'tout est à jour'}</span>
        </div>
        <button
          type="button"
          className={`kpi kpi-button ${totals.counterpartsOverdue ? 'kpi-alert' : totals.counterpartsUrgent ? 'kpi-warn' : ''} ${urgentFilter ? 'is-active' : ''}`}
          onClick={() => updateParams({ contreparties: urgentFilter ? null : 'urgent' })}
          aria-pressed={urgentFilter}
          title={urgentFilter ? 'Afficher tous les partenaires' : 'Afficher les partenaires concernés'}
        >
          <span className="kpi-label">Contreparties à échéance</span>
          <strong className="kpi-value">{totals.counterpartsUrgent}</strong>
          <span className="kpi-sub">
            {totals.counterpartsOverdue
              ? `dont ${totals.counterpartsOverdue} en retard`
              : totals.counterpartsUrgent
                ? 'dans les 7 jours'
                : "rien d'urgent"}
          </span>
        </button>
      </div>

      <div className="filters">
        <button
          type="button"
          className={`filter ${statusFilter === 'all' ? 'filter-active' : ''}`}
          onClick={() => updateParams({ statut: null })}
        >
          Tous <span className="filter-count">{counts.all}</span>
        </button>
        {SPONSOR_STATUSES.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`filter ${statusFilter === s.key ? 'filter-active' : ''}`}
            onClick={() => updateParams({ statut: s.key })}
          >
            <span className={`status-dot status-${s.key}`} aria-hidden="true" />
            {s.label} <span className="filter-count">{counts[s.key] || 0}</span>
          </button>
        ))}
        <select
          className={`filter promo-filter ${ownerFilter ? 'filter-active' : ''}`}
          value={ownerFilter}
          onChange={(e) => updateParams({ resp: e.target.value })}
          aria-label="Filtrer par responsable"
        >
          <option value="">Tous les responsables</option>
          <option value="me">Mes partenaires</option>
          <option value="none">Sans responsable</option>
          {team.map((m) => (
            <option key={m.id} value={m.id}>
              {m.fullName}
            </option>
          ))}
          {externalOwners.map((name) => (
            <option key={name} value={`ext:${name}`}>
              {name} (hors équipe)
            </option>
          ))}
        </select>
        <select
          className={`filter promo-filter ${tierFilter ? 'filter-active' : ''}`}
          value={tierFilter}
          onChange={(e) => updateParams({ rang: e.target.value })}
          aria-label="Filtrer par rang"
        >
          <option value="">Tous les rangs</option>
          {[...tiers].sort((a, b) => b.position - a.position).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
          <option value="none">Sans rang</option>
        </select>
      </div>

      <div className="results-bar">
        <span className="muted">
          {visible.length} partenaire{visible.length > 1 ? 's' : ''}
          {hasFilters && ` sur ${sponsors.length}`}
        </span>
        <div className="results-actions">
          {hasFilters && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => updateParams({ q: null, statut: null, resp: null, rang: null, contreparties: null })}>
              Réinitialiser les filtres
            </button>
          )}
          <input
            type="search"
            className="search search-sm"
            placeholder="Rechercher…"
            value={search}
            onChange={(e) => updateParams({ q: e.target.value })}
            aria-label="Rechercher un partenaire"
          />
        </div>
      </div>

      {rowError && <div className="alert alert-error">{rowError}</div>}

      {sponsors.length === 0 ? (
        <div className="card empty-state">
          <h2>Aucun partenaire pour l'instant</h2>
          <p className="muted">Ajoute les entreprises à démarcher pour suivre leurs avancées.</p>
          <button type="button" className="btn btn-primary" onClick={() => setDialog({})}>
            + Nouveau partenaire
          </button>
        </div>
      ) : visible.length === 0 ? (
        <p className="muted empty-state">Aucun partenaire ne correspond.</p>
      ) : (
        <div className="card directory">
          <table className="directory-table sponsor-table">
            <thead>
              <tr>
                {COLUMNS.map((column) => {
                  const active = sortKey === column.key;
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      className={`col-${column.key}`}
                      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                      <button type="button" className={`sort-button ${active ? 'is-active' : ''}`} onClick={() => handleSort(column)}>
                        {column.label}
                        <span className="sort-arrow" aria-hidden="true">
                          {active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => {
                const followUp = followUpState(s);
                const counterparts = counterpartSummary(s);
                return (
                  <tr key={s.id} className="member-row" onClick={() => setDialog(s)}>
                    <td className="col-name">
                      <div className="sponsor-name">
                        <strong>{s.name}</strong>
                        {s.contacts.length > 0 && (
                          <span
                            className="muted small"
                            title={s.contacts.map((c) => [c.name || c.email || c.phone, c.role].filter(Boolean).join(' · ')).join('\n')}
                          >
                            {[s.contacts[0].name || s.contacts[0].email || s.contacts[0].phone, s.contacts[0].role]
                              .filter(Boolean)
                              .join(' · ')}
                            {s.contacts.length > 1 && <span className="contact-more"> +{s.contacts.length - 1}</span>}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="col-status" onClick={(e) => e.stopPropagation()}>
                      <select
                        className={`status-select status-${s.status}`}
                        value={s.status}
                        onChange={(e) => changeStatus(s, e.target.value)}
                        aria-label={`Statut de ${s.name}`}
                      >
                        {SPONSOR_STATUSES.map((st) => (
                          <option key={st.key} value={st.key}>
                            {st.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={`col-tier ${s.tier || s.status === 'signed' ? '' : 'is-empty'}`}>
                      {s.tier ? (
                        <TagPill tag={s.tier} />
                      ) : s.status === 'signed' ? (
                        // Signé avant l'ajout des rangs : à compléter
                        <span className="tier-missing" title="Un partenaire signé doit avoir un rang">
                          ⚠ à définir
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="col-amount">
                      <span className="cell-prefix">Apport : </span>
                      {s.amount !== null ? <strong>{formatEuro(s.amount)}</strong> : <span className="muted">—</span>}
                      <span className="muted small"> · {CONTRIBUTION_LABEL[s.contributionType]}</span>
                    </td>
                    <td className={`col-owner ${ownerLabel(s) ? '' : 'is-empty'}`}>
                      <span className="cell-prefix">Responsable : </span>
                      {ownerLabel(s) || <span className="muted">—</span>}
                    </td>
                    <td className={`col-counterparts ${counterparts.total ? '' : 'is-empty'}`}>
                      <span className="cell-prefix">Contreparties : </span>
                      {counterparts.total ? (
                        <span className="counterpart-cell">
                          <span className="counterpart-progress" title="Contreparties faites / prévues">
                            {counterparts.done}/{counterparts.total}
                          </span>
                          <CounterpartCell summary={counterparts} />
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className={`col-followUp ${s.nextActionDate ? '' : 'is-empty'}`}>
                      <span className="cell-prefix">Relance : </span>
                      {s.nextActionDate ? (
                        <span className={`follow-up ${followUp ? `follow-up-${followUp}` : ''}`}>
                          {followUp === 'overdue' && '⚠ '}
                          {formatDate(s.nextActionDate)}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {dialog && (
        <SponsorDialog
          sponsor={dialog.id ? dialog : null}
          team={team}
          tiers={tiers}
          presetStatus={dialog.presetStatus}
          defaultOwnerId={team.some((m) => m.id === myId) ? myId : ''}
          onCreateTier={createTier}
          onSave={saveSponsor}
          onDelete={deleteSponsor}
          onClose={() => setDialog(null)}
        />
      )}

      {tiersOpen && (
        <TiersDialog
          tiers={tiers}
          onClose={(changed) => {
            setTiersOpen(false);
            if (changed) loadAll(); // noms / couleurs mis à jour dans le tableau
          }}
        />
      )}
    </div>
  );
}
