// Récap du lundi par mail :
//  - chaque membre actif ayant des tâches ouvertes (« À faire » ou « En cours ») reçoit la liste de SES tâches ;
//  - les membres actifs du bureau reçoivent en plus l'ensemble des tâches ouvertes de tout le monde ;
//  - rien aux membres sans tâche (hors bureau), ni aux alumni, membres d'honneur ou comptes non validés.
// Un seul envoi par personne et par semaine (notification_log), désactivable par chaque membre.
const { query } = require('../db');
const mailer = require('../mailer');
const { TIME_ZONE, frDate } = require('./time');

const KIND = 'weekly_digest';
const STATUS = { todo: 'À faire', doing: 'En cours' };

// Tâches ouvertes avec leurs responsables (membres ou noms libres), et la date du jour à Paris
async function loadOpenTasks() {
  const { rows } = await query(
    `WITH today AS (SELECT (NOW() AT TIME ZONE '${TIME_ZONE}')::date AS d)
     SELECT t.id, t.title, t.status, to_char(t.due_date, 'YYYY-MM-DD') AS due_date, p.name AS pole,
            (today.d - t.due_date) AS days_late, today.d::text AS today,
            COALESCE(json_agg(json_build_object('userId', a.user_id, 'name', COALESCE(u.full_name, a.name))
                              ORDER BY a.position) FILTER (WHERE a.id IS NOT NULL), '[]') AS assignees
       FROM tasks t
       LEFT JOIN task_poles p ON p.id = t.pole_id
       LEFT JOIN task_assignees a ON a.task_id = t.id
       LEFT JOIN users u ON u.id = a.user_id
       CROSS JOIN today
      WHERE t.status IN ('todo', 'doing')
      GROUP BY t.id, p.name, today.d
      ORDER BY t.due_date NULLS LAST, t.id`
  );
  return rows;
}

const taskItem = (t, { withAssignees = false } = {}) => {
  const notes = [STATUS[t.status]];
  if (t.due_date) {
    notes.push(t.days_late > 0 ? `en retard depuis le ${frDate(t.due_date)}` : t.days_late === 0 ? 'échéance aujourd’hui' : `échéance le ${frDate(t.due_date)}`);
  }
  if (t.pole) notes.push(t.pole);
  if (withAssignees && t.assignees.length > 1) notes.push(`avec ${t.assignees.length - 1} autre(s)`);
  return { item: t.title, note: notes.join(' · '), alert: t.days_late > 0 };
};

function personalBlocks(tasks) {
  const late = tasks.filter((t) => t.days_late > 0);
  const blocks = [{ heading: `Mes tâches (${tasks.length})` }];
  if (late.length) blocks.push(`Dont ${late.length} en retard.`);
  blocks.push(...tasks.map((t) => taskItem(t)));
  return blocks;
}

// Vue d'ensemble pour le bureau : par responsable (ordre alphabétique), puis les tâches sans responsable
function overviewBlocks(tasks) {
  const late = tasks.filter((t) => t.days_late > 0).length;
  const unassigned = tasks.filter((t) => t.assignees.length === 0);
  const byPerson = new Map();
  for (const t of tasks) {
    for (const a of t.assignees) {
      const key = a.userId ? `u${a.userId}` : `n${String(a.name).toLowerCase()}`;
      if (!byPerson.has(key)) byPerson.set(key, { name: a.userId ? a.name : `${a.name} (sans compte)`, tasks: [] });
      byPerson.get(key).tasks.push(t);
    }
  }
  const people = [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const blocks = [
    { heading: 'Toutes les tâches ouvertes (bureau)' },
    `${tasks.length} tâche(s) « À faire » ou « En cours », dont ${late} en retard et ${unassigned.length} sans responsable.`,
  ];
  for (const p of people) {
    const pl = p.tasks.filter((t) => t.days_late > 0).length;
    blocks.push({ heading: `${p.name} · ${p.tasks.length}${pl ? ` (${pl} en retard)` : ''}` });
    blocks.push(...p.tasks.map((t) => taskItem(t)));
  }
  if (unassigned.length) {
    blocks.push({ heading: `Sans responsable · ${unassigned.length}` });
    blocks.push(...unassigned.map((t) => taskItem(t)));
  }
  return blocks;
}

// Destinataires et contenu de la semaine (aucun envoi)
async function buildDigests() {
  const [tasks, { rows: users }] = await Promise.all([
    loadOpenTasks(),
    query(
      `SELECT id, email, full_name, is_bureau FROM users
        WHERE status = 'active' AND notify_weekly_digest ORDER BY id`
    ),
  ]);
  const today = tasks[0]?.today || (await query(`SELECT (NOW() AT TIME ZONE '${TIME_ZONE}')::date::text AS d`)).rows[0].d;
  const digests = [];
  for (const u of users) {
    const mine = tasks.filter((t) => t.assignees.some((a) => a.userId === u.id));
    if (!u.is_bureau && mine.length === 0) continue; // rien à dire à ce membre cette semaine
    const firstName = String(u.full_name || '').split(' ')[0] || 'à toi';
    const paragraphs = [`Bonjour ${firstName},`, 'Voici le point de la semaine sur les tâches de l’ERP.'];
    if (mine.length) paragraphs.push(...personalBlocks(mine));
    else paragraphs.push('Aucune tâche ouverte ne t’est assignée en ce moment.');
    if (u.is_bureau) paragraphs.push(...overviewBlocks(tasks));
    const subject = u.is_bureau
      ? `ERP ARECE · Récap de la semaine : ${tasks.length} tâche(s) ouverte(s)`
      : `ERP ARECE · Tes ${mine.length} tâche(s) de la semaine`;
    const { text, html } = mailer.layout({
      title: 'Récap de la semaine',
      paragraphs,
      button: { label: 'Ouvrir les tâches', url: `${mailer.PUBLIC_URL}/taches` },
      footer:
        'Récap envoyé chaque lundi par l’ERP ARECE aux membres qui ont des tâches en cours, et au bureau. ' +
        'Pour ne plus le recevoir : Informations de connexion → Notifications par mail.',
    });
    digests.push({ userId: u.id, email: u.email, fullName: u.full_name, isBureau: u.is_bureau, myCount: mine.length, today, subject, text, html });
  }
  return digests;
}

// Envoie les récaps de la semaine qui ne l'ont pas encore été
async function sendWeeklyDigest() {
  if (!mailer.isEnabled()) return { sent: 0, skipped: 'mail non configuré' };
  const digests = await buildDigests();
  let sent = 0;
  const errors = [];
  for (const d of digests) {
    const { rowCount } = await query(
      `INSERT INTO notification_log (user_id, kind, sent_on) VALUES ($1, $2, $3::date)
       ON CONFLICT (user_id, kind, sent_on) DO NOTHING`,
      [d.userId, KIND, d.today]
    );
    if (rowCount === 0) continue;
    try {
      await mailer.sendMail({ to: d.email, subject: d.subject, text: d.text, html: d.html });
      sent += 1;
    } catch (err) {
      await query('DELETE FROM notification_log WHERE user_id = $1 AND kind = $2 AND sent_on = $3::date', [d.userId, KIND, d.today]);
      errors.push(`${d.email} : ${err.message}`);
    }
  }
  return { sent, recipients: digests.length, errors };
}

module.exports = { buildDigests, sendWeeklyDigest, KIND };
