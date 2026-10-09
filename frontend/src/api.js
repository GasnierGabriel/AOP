import axios from 'axios';

export const TOKEN_KEY = 'arece_token';

export const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3000/api';

const api = axios.create({ baseURL: API_BASE });

// Adresses refusées comme identifiant (même liste par défaut que l'API)
export const BLOCKED_EMAIL_DOMAINS = ['arece.eu', 'edu.ece.fr'];
export const isBlockedEmail = (email = '') =>
  BLOCKED_EMAIL_DOMAINS.includes(email.trim().toLowerCase().split('@').pop());

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Session expirée / révoquée : on nettoie et on renvoie vers /login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && localStorage.getItem(TOKEN_KEY)) {
      localStorage.removeItem(TOKEN_KEY);
      window.location.assign('/login');
    }
    return Promise.reject(error);
  }
);

export function errorMessage(error, fallback = 'Une erreur est survenue') {
  if (!error.response) return 'Serveur injoignable, réessaie dans un instant';
  return error.response.data?.error || fallback;
}

export default api;
