import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// Retour de la connexion Google : l'API renvoie le jeton dans le fragment (#token=…),
// que l'on retire aussitôt de l'URL et de l'historique.
export default function GoogleCallback({ onAuth }) {
  const navigate = useNavigate();

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    window.history.replaceState(null, '', window.location.pathname);
    if (token) {
      onAuth(token);
      navigate('/annuaire', { replace: true });
    } else {
      navigate('/login?google=failed', { replace: true });
    }
  }, []); // une seule fois, au retour de Google

  return <div className="loading" role="status">Connexion en cours…</div>;
}
