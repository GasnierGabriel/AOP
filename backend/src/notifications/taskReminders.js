// Relance quotidienne par mail : chaque responsable (membre actif de l'ERP) reçoit un récapitulatif de ses tâches
// « À faire » dont l'échéance est dépassée. Un seul mail par personne et par jour (table notification_log).
// Rien aux alumni, membres d'honneur ni comptes non validés. Désactivable par chaque membre.
// Planifié par ./scheduler.js.
const { query } = require('../db');
const mailer = require('../mailer');
const { TIME_ZONE, frDate } = require('./time');

const KIND = 'task_overdue_todo';

// Tâches « À faire » en retard (échéance avant aujourd'hui, heure de Paris), par responsable ayant un compte
async function overdueTodoByUser() {
  const { rows } = await query(
    `WITH today AS (SELECT (NOW() AT TIME ZONE '${TIME_ZONE}')::date AS d)
     SELECT u.id AS user_id, u.email, u.full_name, t.id AS task_id, t.title,
            to_char(t.due_date, 'YYYY-MM-DD') AS due_date, (today.d - t.due_date) AS days_late,
            p.name AS pole_name, today.d::text AS today
       FROM tasks t
       JOIN task_assignees a ON a.task_id = t.id
       JOIN users u ON u.id = a.user_id
       LEFT JOIN task_poles p ON p.id = t.pole_id
       CROSS JOIN today
      WHERE t.status = 'todo' AND t.due_date IS NOT NULL AND t.due_date < today.d
        AND u.status = 'active' AND u.notify_task_reminders
      ORDER BY u.id, t.due_date, t.id`
  );
  const byUser = new Map();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, { userId: r.user_id, email: r.email, fullName: r.full_name, today: r.today, tasks: [] });
    byUser.get(r.user_id).tasks.push({ id: r.task_id, title: r.title, dueDate: r.due_date, daysLate: r.days_late, pole: r.pole_name });
  }
  return [...byUser.values()];
}

function buildMail({ fullName, tasks }) {
  const firstName = String(fullName || '').split(' ')[0] || 'à toi';
  const n = tasks.length;
  const items = tasks.map((t) => ({
    item: t.title,
    note: `échéance le ${frDate(t.dueDate)}, ${t.daysLate} jour${t.daysLate > 1 ? 's' : ''} de retard${t.pole ? ` · ${t.pole}` : ''}`,
    alert: true,
  }));
  const { text, html } = mailer.layout({
    title: n > 1 ? `${n} tâches en retard` : 'Une tâche en retard',
    paragraphs: [
      `Bonjour ${firstName},`,
      n > 1
        ? `Ces ${n} tâches dont tu es responsable sont encore dans « À faire » alors que leur échéance est passée :`
        : 'Cette tâche dont tu es responsable est encore dans « À faire » alors que son échéance est passée :',
      ...items,
      'Commence-la (« En cours »), décale son échéance ou marque-la comme faite, et la relance s’arrêtera.',
    ],
    button: { label: 'Voir mes tâches', url: `${mailer.PUBLIC_URL}/taches` },
    footer:
      'Relance quotidienne de l’ERP ARECE, envoyée tant qu’une de tes tâches « À faire » est en retard. ' +
      'Pour ne plus la recevoir : Informations de connexion → Notifications par mail.',
  });
  return { subject: `ERP ARECE · ${n > 1 ? `${n} tâches en retard` : '1 tâche en retard'}`, text, html };
}

// Envoie les relances du jour qui ne l'ont pas encore été ; renvoie un bilan
async function sendTaskReminders() {
  if (!mailer.isEnabled()) return { sent: 0, skipped: 'mail non configuré' };
  const recipients = await overdueTodoByUser();
  let sent = 0;
  const errors = [];
  for (const r of recipients) {
    // Réserve l'envoi du jour (une seule fois par personne, même après un redémarrage)
    const { rowCount } = await query(
      `INSERT INTO notification_log (user_id, kind, sent_on) VALUES ($1, $2, $3::date)
       ON CONFLICT (user_id, kind, sent_on) DO NOTHING`,
      [r.userId, KIND, r.today]
    );
    if (rowCount === 0) continue;
    try {
      await mailer.sendMail({ to: r.email, ...buildMail(r) });
      sent += 1;
    } catch (err) {
      // Échec : on libère la réservation pour réessayer au prochain passage
      await query('DELETE FROM notification_log WHERE user_id = $1 AND kind = $2 AND sent_on = $3::date', [r.userId, KIND, r.today]);
      errors.push(`${r.email} : ${err.message}`);
    }
  }
  return { sent, recipients: recipients.length, errors };
}

module.exports = { sendTaskReminders, overdueTodoByUser, buildMail, KIND };
