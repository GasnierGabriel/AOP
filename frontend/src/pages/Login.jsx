import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import api, { BLOCKED_EMAIL_DOMAINS, errorMessage, isBlockedEmail } from '../api';
import { GOOGLE_MESSAGES, GoogleIcon, googleLoginUrl, loadAuthConfig } from '../googleSso';
import PasswordField from '../components/PasswordField';

export default function Login({ onAuth }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  // Page demandée avant la connexion (chemin interne uniquement)
  const from = typeof location.state?.from === 'string' && location.state.from.startsWith('/') ? location.state.from : '/annuaire';
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [google, setGoogle] = useState({ enabled: false, domain: 'arece.eu' });
  const [passwordReset, setPasswordReset] = useState(false);

  useEffect(() => {
    loadAuthConfig().then((config) => {
      setGoogle(config.google);
      setPasswordReset(Boolean(config.passwordReset));
    });
  }, []);

  const googleMessage = GOOGLE_MESSAGES[params.get('google')];
  const blocked = isBlockedEmail(form.email);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { data } = await api.post('/auth/login', form);
      onAuth(data.token);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Connexion impossible'));
      setSubmitting(false);
    }
  };

  return (
    <div className="card auth-card">
      <h1>Connexion</h1>
      <p className="muted">Annuaire des membres ARECE</p>

      {googleMessage && <div role={googleMessage.type === 'error' ? 'alert' : 'status'} className={`alert alert-${googleMessage.type} auth-alert`}>{googleMessage.text}</div>}

      {google.enabled && (
        <>
          <a className="btn btn-google" href={googleLoginUrl()}>
            <GoogleIcon />
            Se connecter avec Google (@{google.domain})
          </a>
          <div className="auth-separator">
            <span>ou avec ton mail perso</span>
          </div>
        </>
      )}

      <form onSubmit={handleSubmit} className="form">
        <label>
          Mail perso
          <input type="email" name="email" value={form.email} onChange={handleChange} required autoComplete="username" spellCheck={false} />
          {blocked && (
            <span className="field-help field-help-error">
              Les adresses {BLOCKED_EMAIL_DOMAINS.map((d) => `@${d}`).join(' et ')} ne servent pas d'identifiant :
              utilise ton mail perso{google.enabled ? ', ou le bouton Google ci-dessus' : ''}.
            </span>
          )}
        </label>
        <PasswordField label="Mot de passe" name="password" value={form.password} onChange={handleChange} required autoComplete="current-password">
          {passwordReset && (
            <Link to="/mot-de-passe-oublie" state={{ email: form.email }} className="field-link">
              Mot de passe oublié ?
            </Link>
          )}
        </PasswordField>
        {error && <div role="alert" className="alert alert-error">{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={submitting || blocked}>
          {submitting ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
      <p className="auth-switch">
        Pas encore de compte ? <Link to="/signup">Créer un compte</Link>
      </p>
    </div>
  );
}
