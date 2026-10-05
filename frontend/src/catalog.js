import api from './api';

// Suggestions de saisie (rôles, pôles, compétitions), partagées entre les éditeurs
let cache = null;

export function loadCatalog({ refresh = false } = {}) {
  if (!cache || refresh) {
    cache = api
      .get('/annuaire/catalog')
      .then(({ data }) => data)
      .catch((err) => {
        cache = null;
        throw err;
      });
  }
  return cache;
}

// 1er septembre de l'année académique en cours (date de début proposée par défaut)
export function academicYearStart(date = new Date()) {
  const year = date.getMonth() >= 8 ? date.getFullYear() : date.getFullYear() - 1;
  return `${year}-09-01`;
}

// Compétitions proposées (l'année est saisie à part)
export const AWAKE = 'Challenge Awake';
export const COMPETITION_CHOICES = ['Formula Student UK', 'Formula Student France', AWAKE];
export const isAwake = (name = '') => name.trim().toLowerCase() === AWAKE.toLowerCase();

// Épreuves proposées selon la compétition (l'ajout libre reste possible)
export const FSUK_EVENTS = [
  'Business Plan Presentation', 'Autonomous Design Event', 'Real World AI', 'Simulation Design Event',
];
export const FS_FRANCE_EVENTS = [
  'Business Plan', 'Cost & Manufacturing', 'Engineering Design',
  'Acceleration', 'Skidpad', 'Autocross', 'Trackdrive', 'Endurance', 'Efficiency',
];
const EVENTS_BY_COMPETITION = {
  'formula student uk': FSUK_EVENTS,
  'formula student france': FS_FRANCE_EVENTS,
};
export const eventsFor = (name = '') => EVENTS_BY_COMPETITION[name.trim().toLowerCase()] || [];

// 1 → « 🥇 1er », 4 → « 4e »
export function formatRank(rank) {
  if (!rank) return '';
  return { 1: '🥇 1er', 2: '🥈 2e', 3: '🥉 3e' }[rank] || `${rank}e`;
}
