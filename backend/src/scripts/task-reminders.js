// Relances des tâches en retard, à la main.
//   node src/scripts/task-reminders.js           → aperçu : qui recevrait quoi aujourd'hui (aucun envoi)
//   node src/scripts/task-reminders.js --envoyer → envoie maintenant les relances du jour pas encore parties
require('dotenv').config();
const { pool } = require('../db');
const { overdueTodoByUser, sendTaskReminders, buildMail } = require('../notifications/taskReminders');

(async () => {
  if (process.argv.includes('--envoyer')) {
    console.log(await sendTaskReminders());
  } else {
    const recipients = await overdueTodoByUser();
    if (recipients.length === 0) console.log('Aucune tâche « À faire » en retard avec un responsable inscrit.');
    for (const r of recipients) {
      console.log(`\n→ ${r.fullName} <${r.email}> : ${buildMail(r).subject}`);
      for (const t of r.tasks) console.log(`   #${t.id} ${t.title} (échéance ${t.dueDate}, ${t.daysLate} j de retard)`);
    }
  }
})()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
