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

// Date du jour au format AAAA-MM-JJ (fuseau local), pour comparer aux dates de relance
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Relance en retard (rouge) ou imminente, sous 3 jours (orange). Sans objet une fois signé ou refusé.
export function followUpState(sponsor) {
  if (!sponsor.nextActionDate || ['signed', 'declined'].includes(sponsor.status)) return null;
  const today = todayIso();
  if (sponsor.nextActionDate < today) return 'overdue';
  const soon = new Date();
  soon.setDate(soon.getDate() + 3);
  const soonIso = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
  return sponsor.nextActionDate <= soonIso ? 'soon' : null;
}
