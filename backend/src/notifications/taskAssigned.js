// Mail « une tâche t'a été assignée » : envoyé à chaque membre actif ajouté comme responsable d'une tâche
// (création ou modification, depuis l'ERP ou un assistant IA), sauf s'il s'est assigné lui-même.
// Rien aux alumni, membres d'honneur ni comptes non validés. Désactivable par chaque membre.
const { query } = require('../db');
const mailer = require('../mailer');
const { frDate } = require('./time');

const STATUS = { todo: 'À faire', doing: 'En cours', done: 'Fait' };
const PRIORITY = { high: 'priorité haute', medium: 'priorité moyenne', low: 'priorité basse' };

function buildMail({ recipient, actor, task, others }) {
  const firstName = String(recipient.full_name || '').split(' ')[0] || 'à toi';
  const notes = [STATUS[task.status], PRIORITY[task.priority]];
  if (task.due_date) notes.push(`échéance le ${frDate(task.due_date)}`);
  if (task.pole) notes.push(task.pole);
  const context = String(task.context || '').trim();
  const paragraphs = [
    `Bonjour ${firstName},`,
    `${actor.full_name} t’a confié cette tâche :`,
    { item: task.title, note: notes.join(' · ') },
  ];
  if (context) paragraphs.push(`Contexte : ${context.length > 500 ? `${context.slice(0, 500).trimEnd()}…` : context}`);
  if (others.length) paragraphs.push(`Avec : ${others.join(', ')}.`);
  const { text, html } = mailer.layout({
    title: 'Une tâche t’a été assignée',
    paragraphs,
    button: { label: 'Ouvrir la tâche', url: `${mailer.PUBLIC_URL}/taches?tache=${task.id}` },
    footer: 'Mail envoyé par Périclès quand on t’assigne une tâche. Pour ne plus le recevoir : Informations de connexion → Notifications par mail.',
  });
  return { subject: `Périclès · Nouvelle tâche pour toi : ${task.title}`, text, html };
}

// userIds : membres nouvellement ajoutés comme responsables ; actor : membre à l'origine de la modification
async function notifyTaskAssigned(taskId, userIds, actor) {
  const ids = [...new Set(userIds)].filter((id) => id && id !== actor.id);
  if (ids.length === 0 || !mailer.isEnabled() || process.env.TASK_REMINDERS === 'off') return { sent: 0 };
  const [{ rows: tasks }, { rows: recipients }, { rows: assignees }] = await Promise.all([
    query(
      `SELECT t.id, t.title, t.context, t.status, t.priority, to_char(t.due_date, 'YYYY-MM-DD') AS due_date, p.name AS pole
         FROM tasks t LEFT JOIN task_poles p ON p.id = t.pole_id WHERE t.id = $1`,
      [taskId]
    ),
    query(
      `SELECT id, email, full_name FROM users
        WHERE id = ANY($1::int[]) AND status = 'active' AND notify_task_assigned`,
      [ids]
    ),
    query(
      `SELECT a.user_id, COALESCE(u.full_name, a.name) AS name
         FROM task_assignees a LEFT JOIN users u ON u.id = a.user_id WHERE a.task_id = $1 ORDER BY a.position`,
      [taskId]
    ),
  ]);
  const task = tasks[0];
  if (!task || task.status === 'done') return { sent: 0 };
  let sent = 0;
  for (const recipient of recipients) {
    const others = assignees.filter((a) => a.user_id !== recipient.id).map((a) => a.name);
    try {
      await mailer.sendMail({ to: recipient.email, ...buildMail({ recipient, actor, task, others }) });
      sent += 1;
    } catch (err) {
      console.error(`📧 Assignation de la tâche ${taskId} : échec de l'envoi à ${recipient.email} : ${err.message}`);
    }
  }
  return { sent };
}

// Lance l'envoi sans retarder la réponse de l'API
function notifyTaskAssignedLater(taskId, userIds, actor) {
  if (!userIds?.length) return;
  notifyTaskAssigned(taskId, userIds, actor).catch((err) => console.error('📧 Assignation : échec', err));
}

module.exports = { notifyTaskAssigned, notifyTaskAssignedLater, buildMail };
