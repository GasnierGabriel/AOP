// Heure de Paris pour les notifications (les conteneurs tournent en UTC)
const TIME_ZONE = 'Europe/Paris';

const parisParts = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return { hour: Number(get('hour')), weekday: get('weekday') }; // weekday : Mon, Tue…
};

// « 2026-11-16 » → « 16 novembre »
const frDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });

module.exports = { TIME_ZONE, parisParts, frDate };
