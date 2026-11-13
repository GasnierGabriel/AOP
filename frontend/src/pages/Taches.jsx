import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { errorMessage } from '../api';
import ColorLabelsDialog from '../components/ColorLabelsDialog';
import TagPill from '../components/TagPill';
import TaskDialog from '../components/TaskDialog';
import { PRIORITIES, PRIORITY_LABEL, TASK_STATUSES, assigneeName, dueState, isAssignedTo } from '../taskConfig';
import { formatDate, initials } from '../utils';

const DONE_PREVIEW = 20; // tâches faites affichées avant « Afficher les autres »
const byPosition = (a, b) => a.position - b.position || a.id - b.id;

function TaskCard({ task, onOpen, onDragStart, onDragEnd, dragging }) {
  const due = dueState(task);
  return (
    <li
      className={`task-card priority-${task.priority} ${dragging ? 'is-dragging' : ''}`}
      data-task-id={task.id}
      draggable
      onDragStart={(e) => onDragStart(e, task)}
      onDragEnd={onDragEnd}
    >
      <button type="button" className="task-card-open" onClick={() => onOpen(task)}>
        <span className="task-card-title">{task.title}</span>
        <span className="task-card-meta">
          {task.pole && <TagPill tag={task.pole} />}
          {task.priority !== 'medium' && <span className={`task-priority priority-${task.priority}`}>{PRIORITY_LABEL[task.priority]}</span>}
          {task.dueDate && (
            <span className={`task-due ${due ? `task-due-${due}` : ''}`} title="Échéance">
              {due === 'overdue' && '⚠ '}
              {formatDate(task.dueDate)}
            </span>
          )}
          {task.commentCount > 0 && (
            <span className="task-comments-count" title={`${task.commentCount} commentaire(s)`}>
              💬 {task.commentCount}
            </span>
          )}
        </span>
        {task.assignees.length > 0 && (
          <span className="task-assignees">
            {task.assignees.map((a) => (
              <span
                key={a.userId ? `u${a.userId}` : `n${a.name}`}
                className={`task-avatar ${a.userId ? '' : 'is-external'}`}
                title={assigneeName(a) + (a.userId ? '' : ' (sans compte)')}
              >
                {initials(assigneeName(a))}
              </span>
            ))}
            <span className="task-assignee-names">{task.assignees.map(assigneeName).join(', ')}</span>
          </span>
        )}
      </button>
    </li>
  );
}

export default function Taches({ session, onSessionChange }) {
  const [tasks, setTasks] = useState([]);
  const [poles, setPoles] = useState([]);
  const [members, setMembers] = useState([]);
  const [canManagePoles, setCanManagePoles] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [boardError, setBoardError] = useState('');
  const [dialog, setDialog] = useState(null); // null | { presetStatus } (nouvelle) | tâche
  const [polesOpen, setPolesOpen] = useState(false);
  const [showAllDone, setShowAllDone] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { status, beforeId }
  const columnRefs = useRef({});

  // Filtres dans l'URL, comme l'annuaire et le sponsoring
  const [params, setParams] = useSearchParams();
  const search = params.get('q') || '';
  const poleFilter = params.get('pole') || '';
  const ownerFilter = params.get('resp') || '';
  const priorityFilter = params.get('prio') || '';
  const lateOnly = params.get('retard') === '1';
  const updateParams = (changes) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '' || value === undefined) next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };

  const loadAll = () =>
    api
      .get('/tasks')
      .then(({ data }) => {
        setTasks(data.tasks);
        setPoles(data.poles);
        setMembers(data.members);
        setCanManagePoles(data.canManagePoles);
      })
      .catch((err) => setError(errorMessage(err, 'Impossible de charger les tâches')))
      .finally(() => setLoading(false));

  useEffect(() => {
    loadAll();
  }, []);

  const myId = session?.user.id;

  // Responsables sans compte, proposés dans le filtre
  const externalNames = useMemo(
    () => [...new Set(tasks.flatMap((t) => t.assignees.filter((a) => !a.userId).map((a) => a.name)))].sort((a, b) => a.localeCompare(b, 'fr')),
    [tasks]
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const matchesOwner = (t) => {
      if (!ownerFilter) return true;
      if (ownerFilter === 'none') return t.assignees.length === 0;
      if (ownerFilter.startsWith('ext:')) return t.assignees.some((a) => !a.userId && a.name === ownerFilter.slice(4));
      return isAssignedTo(t, ownerFilter === 'me' ? myId : Number(ownerFilter));
    };
    return tasks.filter(
      (t) =>
        (!poleFilter || (poleFilter === 'none' ? !t.pole : t.pole?.id === Number(poleFilter))) &&
        (!priorityFilter || t.priority === priorityFilter) &&
        (!lateOnly || ['overdue', 'today'].includes(dueState(t))) &&
        matchesOwner(t) &&
        (!term || [t.title, t.context, ...t.assignees.map(assigneeName)].some((x) => x && x.toLowerCase().includes(term)))
    );
  }, [tasks, search, poleFilter, ownerFilter, priorityFilter, lateOnly, myId]);

  const columns = useMemo(
    () => Object.fromEntries(TASK_STATUSES.map((s) => [s.key, visible.filter((t) => t.status === s.key).sort(byPosition)])),
    [visible]
  );
  const myOpen = tasks.filter((t) => t.status !== 'done' && isAssignedTo(t, myId)).length;
  const lateCount = tasks.filter((t) => ['overdue', 'today'].includes(dueState(t))).length;
  const hasFilters = Boolean(search || poleFilter || ownerFilter || priorityFilter || lateOnly);

  const replaceTask = (task) => setTasks((list) => list.map((t) => (t.id === task.id ? task : t)));

  const saveTask = async (values) => {
    if (dialog?.id) {
      const { data } = await api.patch(`/tasks/${dialog.id}`, values);
      replaceTask(data.task);
    } else {
      const { data } = await api.post('/tasks', values);
      setTasks((list) => [...list, data.task]);
    }
    setDialog(null);
    onSessionChange?.(); // badge « Tâches » du menu
  };

  const deleteTask = async () => {
    await api.delete(`/tasks/${dialog.id}`);
    setTasks((list) => list.filter((t) => t.id !== dialog.id));
    setDialog(null);
    onSessionChange?.();
  };

  /* ---------- Glisser-déposer entre colonnes et dans une colonne ---------- */

  const handleDragStart = (e, task) => {
    setDragId(task.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(task.id));
  };
  const handleDragEnd = () => {
    setDragId(null);
    setDropTarget(null);
  };

  // Carte avant laquelle déposer, d'après la position verticale du curseur
  const targetFor = (status, clientY) => {
    const cards = [...(columnRefs.current[status]?.querySelectorAll('[data-task-id]') || [])].filter(
      (el) => Number(el.dataset.taskId) !== dragId
    );
    const before = cards.find((el) => {
      const rect = el.getBoundingClientRect();
      return clientY < rect.top + rect.height / 2;
    });
    return { status, beforeId: before ? Number(before.dataset.taskId) : null };
  };

  const handleDragOver = (e, status) => {
    if (dragId === null) return;
    e.preventDefault();
    const target = targetFor(status, e.clientY);
    if (target.status !== dropTarget?.status || target.beforeId !== dropTarget?.beforeId) setDropTarget(target);
  };

  const handleDrop = async (e, status) => {
    e.preventDefault();
    const task = tasks.find((t) => t.id === dragId);
    const { beforeId } = targetFor(status, e.clientY);
    handleDragEnd();
    if (!task) return;

    // Nouvelle position : entre la carte précédente et la suivante de la colonne
    const list = columns[status].filter((t) => t.id !== task.id);
    const index = beforeId === null ? list.length : list.findIndex((t) => t.id === beforeId);
    const prev = list[index - 1];
    const next = list[index];
    const position = prev && next ? (prev.position + next.position) / 2 : prev ? prev.position + 1 : next ? next.position - 1 : 0;
    if (task.status === status && task.position === position) return;

    const before = task;
    replaceTask({ ...task, status, position }); // affichage immédiat
    setBoardError('');
    try {
      const { data } = await api.patch(`/tasks/${task.id}`, { status, position });
      replaceTask(data.task);
      if (task.status !== status) onSessionChange?.();
    } catch (err) {
      replaceTask(before);
      setBoardError(errorMessage(err, 'Impossible de déplacer la tâche'));
    }
  };

  if (loading) return <div className="loading">Chargement…</div>;
  if (error) return <div className="alert alert-error">{error}</div>;

  const defaultAssignee = members.find((m) => m.id === myId);

  return (
    <div className="taches">
      <div className="page-header">
        <div>
          <h1>Tâches</h1>
          <p className="muted">Kanban de l'asso · glisse les cartes d'une colonne à l'autre</p>
        </div>
        <div className="wiki-header-actions">
          {canManagePoles && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setPolesOpen(true)}>
              Pôles
            </button>
          )}
          <button type="button" className="btn btn-light" onClick={() => setDialog({ presetStatus: 'todo' })}>
            + Nouvelle tâche
          </button>
        </div>
      </div>

      <div className="filters">
        <button
          type="button"
          className={`filter ${ownerFilter === 'me' ? 'filter-active' : ''}`}
          onClick={() => updateParams({ resp: ownerFilter === 'me' ? null : 'me' })}
          aria-pressed={ownerFilter === 'me'}
        >
          Mes tâches <span className="filter-count">{myOpen}</span>
        </button>
        <button
          type="button"
          className={`filter ${lateOnly ? 'filter-active' : ''}`}
          onClick={() => updateParams({ retard: lateOnly ? null : '1' })}
          aria-pressed={lateOnly}
        >
          <span className="status-dot status-declined" aria-hidden="true" />
          En retard <span className="filter-count">{lateCount}</span>
        </button>
        <select
          className={`filter promo-filter ${poleFilter ? 'filter-active' : ''}`}
          value={poleFilter}
          onChange={(e) => updateParams({ pole: e.target.value })}
          aria-label="Filtrer par pôle"
        >
          <option value="">Tous les pôles</option>
          {poles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="none">Sans pôle</option>
        </select>
        <select
          className={`filter promo-filter ${ownerFilter && ownerFilter !== 'me' ? 'filter-active' : ''}`}
          value={ownerFilter === 'me' ? '' : ownerFilter}
          onChange={(e) => updateParams({ resp: e.target.value })}
          aria-label="Filtrer par responsable"
        >
          <option value="">Tous les responsables</option>
          <option value="none">Sans responsable</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.fullName}
            </option>
          ))}
          {externalNames.map((name) => (
            <option key={name} value={`ext:${name}`}>
              {name} (sans compte)
            </option>
          ))}
        </select>
        <select
          className={`filter promo-filter ${priorityFilter ? 'filter-active' : ''}`}
          value={priorityFilter}
          onChange={(e) => updateParams({ prio: e.target.value })}
          aria-label="Filtrer par priorité"
        >
          <option value="">Toutes priorités</option>
          {PRIORITIES.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="results-bar">
        <span className="muted">
          {visible.length} tâche{visible.length > 1 ? 's' : ''}
          {hasFilters && ` sur ${tasks.length}`}
        </span>
        <div className="results-actions">
          {hasFilters && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => updateParams({ q: null, pole: null, resp: null, prio: null, retard: null })}
            >
              Réinitialiser les filtres
            </button>
          )}
          <input
            type="search"
            className="search search-sm"
            placeholder="Rechercher…"
            value={search}
            onChange={(e) => updateParams({ q: e.target.value })}
            aria-label="Rechercher une tâche"
          />
        </div>
      </div>

      {boardError && <div className="alert alert-error">{boardError}</div>}

      <div className="kanban">
        {TASK_STATUSES.map((s) => {
          const list = columns[s.key];
          const collapsed = s.key === 'done' && !showAllDone && list.length > DONE_PREVIEW;
          const shown = collapsed ? list.slice(0, DONE_PREVIEW) : list;
          return (
            <section
              key={s.key}
              className={`kanban-column column-${s.key} ${dropTarget?.status === s.key ? 'is-drop-target' : ''}`}
              onDragOver={(e) => handleDragOver(e, s.key)}
              onDrop={(e) => handleDrop(e, s.key)}
              aria-label={s.label}
            >
              <header className="kanban-column-head">
                <h2>{s.label}</h2>
                <span className="kanban-count">{list.length}</span>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setDialog({ presetStatus: s.key })}
                  title={`Nouvelle tâche « ${s.label} »`}
                  aria-label={`Nouvelle tâche dans ${s.label}`}
                >
                  +
                </button>
              </header>
              <ul className="kanban-list" ref={(el) => (columnRefs.current[s.key] = el)}>
                {shown.map((t) => (
                  <FragmentWithDrop key={t.id} show={dropTarget?.status === s.key && dropTarget.beforeId === t.id}>
                    <TaskCard
                      task={t}
                      onOpen={setDialog}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                      dragging={dragId === t.id}
                    />
                  </FragmentWithDrop>
                ))}
                {dropTarget?.status === s.key && dropTarget.beforeId === null && <li className="drop-indicator" aria-hidden="true" />}
                {list.length === 0 && <li className="kanban-empty muted small">Aucune tâche</li>}
              </ul>
              {collapsed && (
                <button type="button" className="btn btn-ghost btn-sm kanban-more" onClick={() => setShowAllDone(true)}>
                  Afficher les {list.length - DONE_PREVIEW} autres
                </button>
              )}
            </section>
          );
        })}
      </div>

      {dialog && (
        <TaskDialog
          task={dialog.id ? dialog : null}
          presetStatus={dialog.presetStatus}
          defaultAssignee={defaultAssignee ? { userId: defaultAssignee.id, fullName: defaultAssignee.fullName } : null}
          poles={poles}
          members={members}
          onSave={saveTask}
          onDelete={deleteTask}
          onCommentCount={(id, count) => setTasks((list) => list.map((t) => (t.id === id ? { ...t, commentCount: count } : t)))}
          onClose={() => setDialog(null)}
        />
      )}

      {polesOpen && (
        <ColorLabelsDialog
          items={poles}
          endpoint="/tasks/poles"
          responseKey="pole"
          title="Pôles"
          help="Les pôles servent à classer et filtrer les tâches."
          noun="pôle"
          countOf={(p) => p.taskCount}
          countLabel={(n) => `${n} tâche${n > 1 ? 's' : ''}`}
          onClose={(changed) => {
            setPolesOpen(false);
            if (changed) loadAll();
          }}
        />
      )}
    </div>
  );
}

// Ligne d'insertion affichée avant la carte survolée pendant un glisser-déposer
function FragmentWithDrop({ show, children }) {
  return (
    <>
      {show && <li className="drop-indicator" aria-hidden="true" />}
      {children}
    </>
  );
}
