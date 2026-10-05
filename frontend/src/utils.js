export const STATUS_LABELS = {
  active: 'Actif',
  alumni: 'Alumni',
  honorary: 'Honoraire',
  prospect: 'Prospect',
};

// '2024-09-01' → '1 sept. 2024' (parsé en date locale pour éviter les décalages UTC)
export function formatDate(value) {
  if (!value) return '';
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function initials(fullName = '') {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}
