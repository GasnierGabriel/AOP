import { useId, useState } from 'react';

// Champ mot de passe avec bouton « Afficher » (pour vérifier sa saisie, surtout sur mobile).
// Le bouton est hors du <label> : il ne s'ajoute pas au nom du champ lu par les lecteurs d'écran.
// L'aide (ex : longueur minimale) est placée au-dessus du champ, là où le clavier mobile ne la cache pas.
export default function PasswordField({ label, help, children, ...inputProps }) {
  const id = useId();
  const helpId = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="field-group">
      <label htmlFor={id}>{label}</label>
      {help && (
        <span id={helpId} className="field-help">
          {help}
        </span>
      )}
      <div className="password-input">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          aria-describedby={help ? helpId : undefined}
          autoCapitalize="none"
          spellCheck={false}
          {...inputProps}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-controls={id}
          aria-label={visible ? `Masquer : ${label}` : `Afficher : ${label}`}
        >
          {visible ? 'Masquer' : 'Afficher'}
        </button>
      </div>
      {children}
    </div>
  );
}
