import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api, { errorMessage } from '../api';
import PasswordField from '../components/PasswordField';

const MIN_PASSWORD_LENGTH = 8;

// Lien reçu par mail : choix du nouveau mot de passe, puis connexion
export default function ReinitialiserMotDePasse({ onAuth }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // Le jeton est retiré de la barre d'adresse dès l'ouverture (historique, partage d'écran…)
  const [token] = useState(() => params.get('token') || '');
  const [status, setStatus] = useState('checking'); // checking | valid | invalid
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (params.has('token')) setParams({}, { replace: true });
    if (!token) {
      setStatus('invalid');
      return;
    }
    api
      .get('/auth/reset-password', { params: { token } })
      .then(() => setStatus('valid'))
      .catch(() => setStatus('invalid'));
    // eslint-disable-next-line
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) return setError('Les deux mots de passe ne correspondent pas');
    setSubmitting(true);
    try {
      const { data } = await api.post('/auth/reset-password', { token, password: form.password });
      onAuth(data.token);
      navigate('/annuaire', { replace: true });
    } catch (err) {
      if (err.response?.data?.code === 'INVALID_RESET_TOKEN') setStatus('invalid');
      setError(errorMessage(err, 'Impossible de changer le mot de passe'));
      setSubmitting(false);
    }
  };

  return (
    <div className="card auth-card">
      <h1>Nouveau mot de passe</h1>
      {status === 'checking' && <p className="muted">Vérification du lien…</p>}
      {status === 'invalid' && (
        <>
          <div role="alert" className="alert alert-error">Ce lien est invalide, a déjà servi ou a expiré (il est valable 1 heure).</div>
          <Link to="/mot-de-passe-oublie" className="btn btn-primary">
            Recevoir un nouveau lien
          </Link>
        </>
      )}
      {status === 'valid' && (
        <form onSubmit={handleSubmit} className="form">
          <p className="muted">Choisis ton nouveau mot de passe : tes autres sessions ouvertes seront déconnectées.</p>
          <PasswordField
            label="Nouveau mot de passe"
            help={`${MIN_PASSWORD_LENGTH} caractères minimum`}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            minLength={MIN_PASSWORD_LENGTH}
            required
            autoComplete="new-password"
            autoFocus
          />
          <PasswordField
            label="Confirmer le mot de passe"
            value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            minLength={MIN_PASSWORD_LENGTH}
            required
            autoComplete="new-password"
          />
          {error && <div role="alert" className="alert alert-error">{error}</div>}
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Enregistrement…' : 'Enregistrer et me connecter'}
          </button>
        </form>
      )}
      <p className="auth-switch">
        <Link to="/login">← Retour à la connexion</Link>
      </p>
    </div>
  );
}
