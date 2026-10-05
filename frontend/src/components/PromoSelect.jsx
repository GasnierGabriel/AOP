// Mêmes bornes que l'API (backend/src/members.js)
export const PROMO_MIN = 2015;
export const promoYears = () => {
  const max = new Date().getFullYear() + 5;
  return Array.from({ length: max - PROMO_MIN + 1 }, (_, i) => max - i); // plus récente en premier
};

// Liste déroulante des promos ; value = année (nombre) ou null
export default function PromoSelect({ value, onChange, emptyLabel = 'Aucune promo', ...props }) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      {...props}
    >
      <option value="">{emptyLabel}</option>
      {promoYears().map((year) => (
        <option key={year} value={year}>
          Promo {year}
        </option>
      ))}
    </select>
  );
}
