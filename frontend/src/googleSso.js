import api, { API_BASE } from './api';

// Options publiques de connexion (SSO Google activé ?), chargées une seule fois
let configPromise = null;
export function loadAuthConfig() {
  if (!configPromise) {
    configPromise = api
      .get('/auth/config')
      .then(({ data }) => data)
      .catch(() => {
        configPromise = null;
        return { google: { enabled: false, domain: 'arece.eu' } };
      });
  }
  return configPromise;
}

// Redirection complète du navigateur vers Google (via l'API)
export const googleLoginUrl = () => `${API_BASE}/auth/google/start?mode=login`;
export const googleLinkUrl = (ticket) =>
  `${API_BASE}/auth/google/start?mode=link&ticket=${encodeURIComponent(ticket)}`;

// Codes renvoyés par l'API dans ?google=… au retour de Google
export const GOOGLE_MESSAGES = {
  linked: { type: 'success', text: 'Ton compte Google ARECE est lié : tu pourras te connecter en un clic.' },
  unknown: {
    type: 'error',
    text: "Aucun compte n'est lié à ce compte Google. Connecte-toi avec ton mail perso, puis lie ton compte Google depuis « Informations de connexion ».",
  },
  domain: { type: 'error', text: 'Seuls les comptes Google de l’association (@arece.eu) sont acceptés.' },
  taken: { type: 'error', text: 'Ce compte Google est déjà lié à un autre membre.' },
  expired: { type: 'error', text: 'La demande a expiré, réessaie.' },
  cancelled: { type: 'error', text: 'Connexion Google annulée.' },
  failed: { type: 'error', text: 'La connexion avec Google a échoué, réessaie dans un instant.' },
  disabled: { type: 'error', text: "La connexion Google n'est pas encore configurée." },
};

export function GoogleIcon() {
  return (
    <svg className="google-icon" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
