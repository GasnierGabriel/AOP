import { todayIso } from './sponsoringConfig';

// Colonnes du Kanban, dans l'ordre d'avancement
export const TASK_STATUSES = [
  { key: 'todo', label: 'À faire' },
  { key: 'doing', label: 'En cours' },
  { key: 'done', label: 'Fait' },
];
export const TASK_STATUS_LABEL = Object.fromEntries(TASK_STATUSES.map((s) => [s.key, s.label]));

export const PRIORITIES = [
  { key: 'high', label: 'Haute' },
  { key: 'medium', label: 'Moyenne' },
  { key: 'low', label: 'Basse' },
];
export const PRIORITY_LABEL = Object.fromEntries(PRIORITIES.map((p) => [p.key, p.label]));

// Échéance proche : sous 3 jours (même seuil que le badge « Tâches » du menu)
export const TASK_SOON_DAYS = 3;

// État de l'échéance d'une tâche non faite : en retard, aujourd'hui, bientôt, ou rien de particulier
export function dueState(task) {
  if (task.status === 'done' || !task.dueDate) return null;
  const today = todayIso();
  if (task.dueDate < today) return 'overdue';
  if (task.dueDate === today) return 'today';
  return task.dueDate <= todayIso(TASK_SOON_DAYS) ? 'soon' : null;
}

// Responsable : membre de l'ERP ({ userId, fullName }) ou nom saisi à la main ({ name })
export const assigneeName = (a) => a.fullName || a.name || '';
export const assigneeKey = (a) => (a.userId ? `u${a.userId}` : `n${(a.name || '').toLowerCase()}`);
export const isAssignedTo = (task, userId) => task.assignees.some((a) => a.userId === userId);
