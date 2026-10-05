import axios from 'axios';

export const TOKEN_KEY = 'arece_token';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:3000/api',
});

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
