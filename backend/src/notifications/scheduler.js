// Planificateur des notifications par mail (vérifie toutes les 10 minutes, heure de Paris) :
//  - chaque jour à partir de TASK_REMINDER_HOUR (8 h) : relance des tâches « À faire » en retard ;
//  - chaque lundi à partir de la même heure : récap de la semaine.
// Chaque envoi est journalisé (notification_log) : jamais deux fois le même mail le même jour.
const mailer = require('../mailer');
const { parisParts } = require('./time');
const { sendTaskReminders } = require('./taskReminders');
const { sendWeeklyDigest } = require('./weeklyDigest');

const HOUR = Number(process.env.TASK_REMINDER_HOUR ?? 8);
const CHECK_EVERY_MS = 10 * 60 * 1000;

const jobs = [
  { name: 'Relances tâches en retard', due: ({ hour }) => hour >= HOUR, run: sendTaskReminders },
  { name: 'Récap de la semaine', due: ({ hour, weekday }) => weekday === 'Mon' && hour >= HOUR, run: sendWeeklyDigest },
];

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const now = parisParts();
    for (const job of jobs) {
      if (!job.due(now)) continue;
      try {
        const result = await job.run();
        if (result.sent || result.errors?.length) {
          console.log(`📧 ${job.name} : ${result.sent} envoyé(s)`, result.errors?.length ? result.errors : '');
        }
      } catch (err) {
        console.error(`📧 ${job.name} : échec`, err);
      }
    }
  } finally {
    running = false;
  }
}

function startNotificationScheduler() {
  if (process.env.TASK_REMINDERS === 'off') return console.log('📧 Notifications par mail : désactivées (TASK_REMINDERS=off)');
  if (!mailer.isEnabled()) return console.log('📧 Notifications par mail : mail non configuré, aucun envoi');
  console.log(`📧 Notifications : relance chaque jour et récap le lundi, à partir de ${HOUR} h (heure de Paris)`);
  setTimeout(tick, 60 * 1000).unref();
  setInterval(tick, CHECK_EVERY_MS).unref();
}

module.exports = { startNotificationScheduler, tick };
