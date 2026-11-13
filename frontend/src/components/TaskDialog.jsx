import { useEffect, useState } from 'react';
import api, { errorMessage } from '../api';
import { PRIORITIES, TASK_STATUSES, assigneeKey, assigneeName, dueState } from '../taskConfig';
import { formatDate } from '../utils';

const OTHER = '__other';
const DUE_LABEL = { overdue: 'En retard', today: "Aujourd'hui", soon: 'Bientôt' };

const fromTask = (t, presetStatus) => ({
  title: t?.title || '',
  context: t?.context || '',
  status: t?.status || presetStatus || 'todo',
  priority: t?.priority || 'medium',
  poleId: t?.pole?.id ?? '',
  dueDate: t?.dueDate || '',
  assignees: t?.assignees || [],
});

const formatDateTime = (value) =>
  new Date(value).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Création / modification d'une tâche, avec ses commentaires (enregistrés immédiatement)
export default function TaskDialog({ task, presetStatus, defaultAssignee, poles, members, onSave, onDelete, onCommentCount, onClose }) {
  const isEdit = Boolean(task?.id);
  const [form, setForm] = useState(() => {
    const initial = fromTask(task, presetStatus);
    if (!isEdit && defaultAssignee) initial.assignees = [defaultAssignee];
    return initial;
  });
  const [otherName, setOtherName] = useState(null); // saisie d'un responsable sans compte
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [comments, setComments] = useState(null);
  const [comment, setComment] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [busy, onClose]);

  useEffect(() => {
    if (!isEdit) return;
    api
      .get(`/tasks/${task.id}/comments`)
      .then(({ data }) => setComments(data.comments))
      .catch(() => setComments([]));
  }, [isEdit, task?.id]);

  const update = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const selected = new Set(form.assignees.map(assigneeKey));
  const addAssignee = (a) =>
    !selected.has(assigneeKey(a)) && setForm((prev) => ({ ...prev, assignees: [...prev.assignees, a] }));
  const removeAssignee = (a) =>
    setForm((prev) => ({ ...prev, assignees: prev.assignees.filter((x) => assigneeKey(x) !== assigneeKey(a)) }));
  const addOther = () => {
    const name = otherName.trim().replace(/\s+/g, ' ');
    if (name) addAssignee({ name });
    setOtherName(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      // Nom tapé dans « Autre » mais pas encore ajouté : pris en compte
      const pending = otherName?.trim() ? [{ name: otherName.trim().replace(/\s+/g, ' ') }] : [];
      await onSave({
        title: form.title,
        context: form.context,
        status: form.status,
        priority: form.priority,
        poleId: form.poleId === '' ? null : Number(form.poleId),
        dueDate: form.dueDate || null,
        assignees: [...form.assignees, ...pending]
          .filter((a, i, list) => list.findIndex((x) => assigneeKey(x) === assigneeKey(a)) === i)
          .map((a) => (a.userId ? { userId: a.userId } : { name: a.name })),
      });
    } catch (err) {
      setError(errorMessage(err, "Impossible d'enregistrer la tâche"));
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Supprimer définitivement la tâche « ${task.title} » et ses commentaires ?`)) return;
    setBusy(true);
    setError('');
    try {
      await onDelete();
    } catch (err) {
      setError(errorMessage(err, 'Impossible de supprimer la tâche'));
      setBusy(false);
    }
  };

  const postComment = async (e) => {
    e.preventDefault();
    if (!comment.trim()) return;
    setCommentBusy(true);
    setError('');
    try {
      const { data } = await api.post(`/tasks/${task.id}/comments`, { body: comment });
      const next = [...(comments || []), data.comment];
      setComments(next);
      setComment('');
      onCommentCount(task.id, next.length);
    } catch (err) {
      setError(errorMessage(err, "Impossible d'ajouter le commentaire"));
    } finally {
      setCommentBusy(false);
    }
  };

  const deleteComment = async (c) => {
    if (!window.confirm('Supprimer ce commentaire ?')) return;
    try {
      await api.delete(`/tasks/comments/${c.id}`);
      const next = comments.filter((x) => x.id !== c.id);
      setComments(next);
      onCommentCount(task.id, next.length);
    } catch (err) {
      setError(errorMessage(err, 'Impossible de supprimer le commentaire'));
    }
  };

  const due = dueState(form);
  const available = members.filter((m) => !selected.has(`u${m.id}`));

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="task-dialog-title">
        <h2 id="task-dialog-title">{isEdit ? 'Tâche' : 'Nouvelle tâche'}</h2>
        <form className="form" onSubmit={handleSubmit}>
          <label>
            Titre
            <input value={form.title} onChange={update('title')} maxLength={300} required autoFocus={!isEdit} />
          </label>
          <div className="form-grid">
            <label>
              Statut
              <select value={form.status} onChange={update('status')}>
                {TASK_STATUSES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priorité
              <select value={form.priority} onChange={update('priority')}>
                {PRIORITIES.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Pôle
              <select value={form.poleId} onChange={update('poleId')}>
                <option value="">— Aucun —</option>
                {poles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>
                Échéance {due && <span className={`cp-badge cp-${due}`}>{DUE_LABEL[due]}</span>}
              </span>
              <input type="date" value={form.dueDate} onChange={update('dueDate')} />
            </label>
          </div>

          <div className="field">
            <span className="field-label">Responsables</span>
            <div className="assignee-editor">
              {form.assignees.map((a) => (
                <span key={assigneeKey(a)} className={`assignee-chip ${a.userId ? '' : 'is-external'}`}>
                  {assigneeName(a)}
                  {!a.userId && <span className="muted"> (sans compte)</span>}
                  <button type="button" onClick={() => removeAssignee(a)} aria-label={`Retirer ${assigneeName(a)}`} title="Retirer">
                    ×
                  </button>
                </span>
              ))}
              {otherName === null ? (
                <select
                  className="assignee-add"
                  value=""
                  onChange={(e) => {
                    if (e.target.value === OTHER) setOtherName('');
                    else {
                      const m = members.find((x) => x.id === Number(e.target.value));
                      if (m) addAssignee({ userId: m.id, fullName: m.fullName });
                    }
                  }}
                  aria-label="Ajouter un responsable"
                >
                  <option value="">+ Ajouter un responsable…</option>
                  {available.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fullName}
                    </option>
                  ))}
                  <option value={OTHER}>Autre (sans compte ERP)…</option>
                </select>
              ) : (
                <span className="assignee-other">
                  <input
                    value={otherName}
                    onChange={(e) => setOtherName(e.target.value)}
                    placeholder="Nom de la personne"
                    maxLength={200}
                    autoFocus
                    aria-label="Nom du responsable sans compte"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addOther();
                      } else if (e.key === 'Escape') {
                        e.stopPropagation();
                        setOtherName(null);
                      }
                    }}
                  />
                  <button type="button" className="btn btn-primary btn-sm" onClick={addOther}>
                    Ajouter
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOtherName(null)}>
                    Annuler
                  </button>
                </span>
              )}
            </div>
          </div>

          <label>
            Contexte
            <textarea
              rows={4}
              value={form.context}
              onChange={update('context')}
              maxLength={5000}
              placeholder="Détails, liens, prochaines étapes…"
            />
          </label>

          {isEdit && (
            <p className="muted small task-meta">
              {task.imported
                ? `Importée depuis Notion le ${formatDate(task.createdAt)}`
                : `${task.createdBy ? `Créée par ${task.createdBy.fullName}` : 'Créée'} le ${formatDate(task.createdAt)}`}
              {task.completedAt && ` · faite le ${formatDate(task.completedAt)}`}
            </p>
          )}

          {error && <div className="alert alert-error">{error}</div>}
          <div className="modal-actions">
            {isEdit && task.canDelete && (
              <button type="button" className="btn btn-danger" onClick={handleDelete} disabled={busy}>
                Supprimer
              </button>
            )}
            <span className="spacer" />
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {isEdit ? 'Enregistrer' : 'Créer'}
            </button>
          </div>
        </form>

        {isEdit && (
          <section className="task-comments">
            <h3>Commentaires</h3>
            {comments === null ? (
              <p className="muted small">Chargement…</p>
            ) : (
              <>
                {comments.length === 0 && <p className="muted small">Aucun commentaire pour l'instant.</p>}
                <ul className="comment-list">
                  {comments.map((c) => (
                    <li key={c.id}>
                      <div className="comment-head">
                        <strong>{c.author?.fullName || c.authorName || 'Ancien membre'}</strong>
                        <span className="muted small">{formatDateTime(c.createdAt)}</span>
                        {c.canDelete && (
                          <button
                            type="button"
                            className="icon-btn icon-btn-danger"
                            onClick={() => deleteComment(c)}
                            title="Supprimer"
                            aria-label="Supprimer le commentaire"
                          >
                            ×
                          </button>
                        )}
                      </div>
                      <p className="comment-body">{c.body}</p>
                    </li>
                  ))}
                </ul>
                <form className="comment-form" onSubmit={postComment}>
                  <textarea
                    rows={2}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    maxLength={5000}
                    placeholder="Ajouter un commentaire…"
                    aria-label="Nouveau commentaire"
                  />
                  <button type="submit" className="btn btn-outline btn-sm" disabled={commentBusy || !comment.trim()}>
                    Commenter
                  </button>
                </form>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
