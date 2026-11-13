// Pipeline des partenaires, dans l'ordre d'avancement
export const SPONSOR_STATUSES = [
  { key: 'to_contact', label: 'À contacter' },
  { key: 'contacted', label: 'Contacté' },
  { key: 'negotiation', label: 'En négociation' },
  { key: 'signed', label: 'Signé' },
  { key: 'declined', label: 'Refusé' },
];
export const STATUS_LABEL = Object.fromEntries(SPONSOR_STATUSES.map((s) => [s.key, s.label]));
export const STATUS_ORDER = Object.fromEntries(SPONSOR_STATUSES.map((s, i) => [s.key, i]));

export const CONTRIBUTION_TYPES = [
  { key: 'money', label: 'Argent' },
  { key: 'material', label: 'Matériel' },
  { key: 'service', label: 'Service' },
  { key: 'mixed', label: 'Mixte' },
];
export const CONTRIBUTION_LABEL = Object.fromEntries(CONTRIBUTION_TYPES.map((t) => [t.key, t.label]));

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
export const formatEuro = (amount) => (amount === null || amount === undefined ? '' : euro.format(amount));

const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Date du jour (+ n jours) au format AAAA-MM-JJ (fuseau local), pour comparer aux dates saisies
export function todayIso(days = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

// Relance en retard (rouge) ou imminente, sous 3 jours (orange). Sans objet une fois signé ou refusé.
export function followUpState(sponsor) {
  if (!sponsor.nextActionDate || ['signed', 'declined'].includes(sponsor.status)) return null;
  if (sponsor.nextActionDate < todayIso()) return 'overdue';
  return sponsor.nextActionDate <= todayIso(3) ? 'soon' : null;
}

// Contreparties : à échéance « proche » sous 7 jours (même seuil que le badge de la barre de navigation)
export const COUNTERPART_SOON_DAYS = 7;

// État d'une contrepartie : faite, en retard, aujourd'hui, bientôt (sous 7 jours) ou rien de particulier
export function counterpartState(counterpart) {
  if (counterpart.done) return 'done';
  if (!counterpart.dueDate) return null;
  const today = todayIso();
  if (counterpart.dueDate < today) return 'overdue';
  if (counterpart.dueDate === today) return 'today';
  return counterpart.dueDate <= todayIso(COUNTERPART_SOON_DAYS) ? 'soon' : null;
}

// Résumé des contreparties d'un partenaire : avancement, urgences et prochaine échéance non faite.
// Un partenaire refusé n'a plus d'échéance à surveiller.
export function counterpartSummary(sponsor) {
  const list = sponsor.counterparts || [];
  const summary = { total: list.length, done: 0, overdue: 0, today: 0, soon: 0, next: null };
  for (const c of list) {
    const state = counterpartState(c);
    if (state === 'done') summary.done += 1;
    else if (sponsor.status !== 'declined') {
      if (state) summary[state] += 1;
      if (c.dueDate && (!summary.next || c.dueDate < summary.next)) summary.next = c.dueDate;
    }
  }
  summary.urgent = summary.overdue + summary.today + summary.soon;
  return summary;
}

// Nom du responsable : membre de l'équipe ou personne saisie à la main
export const ownerLabel = (sponsor) => sponsor.owner?.fullName || sponsor.ownerExternal || null;
