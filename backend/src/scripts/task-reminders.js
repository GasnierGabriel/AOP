// Notifications des tâches, à la main (aperçu par défaut, aucun envoi) :
//   node src/scripts/task-reminders.js                    → relances du jour (tâches « À faire » en retard)
//   node src/scripts/task-reminders.js --envoyer          → envoie maintenant les relances du jour pas encore parties
//   node src/scripts/task-reminders.js --recap            → récap du lundi : qui le recevrait, avec quoi
//   node src/scripts/task-reminders.js --recap --envoyer  → envoie maintenant le récap (une fois par jour et par personne)
require('dotenv').config();
const { pool } = require('../db');
const { overdueTodoByUser, sendTaskReminders, buildMail } = require('../notifications/taskReminders');
const { buildDigests, sendWeeklyDigest } = require('../notifications/weeklyDigest');

const send = process.argv.includes('--envoyer');
const recap = process.argv.includes('--recap');

(async () => {
  if (recap && send) return console.log(await sendWeeklyDigest());
  if (send) return console.log(await sendTaskReminders());
  if (recap) {
    const digests = await buildDigests();
    if (digests.length === 0) console.log('Personne ne recevrait de récap.');
    for (const d of digests) {
      console.log(`→ ${d.fullName}${d.isBureau ? ' [bureau]' : ''} : ${d.subject} (${d.myCount} tâche(s) personnelle(s))`);
    }
    return undefined;
  }
  const recipients = await overdueTodoByUser();
  if (recipients.length === 0) console.log('Aucune tâche « À faire » en retard avec un responsable actif.');
  for (const r of recipients) {
    console.log(`\n→ ${r.fullName} : ${buildMail(r).subject}`);
    for (const t of r.tasks) console.log(`   #${t.id} ${t.title} (échéance ${t.dueDate}, ${t.daysLate} j de retard)`);
  }
  return undefined;
})()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
