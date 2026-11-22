import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import api, { BLOCKED_EMAIL_DOMAINS, errorMessage, isBlockedEmail } from '../api';

// Demande d'un lien de réinitialisation du mot de passe, envoyé sur le mail perso du compte
export default function MotDePasseOublie() {
  const location = useLocation();
  const [email, setEmail] = useState(location.state?.email || '');
  const [sent, setSent] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const blocked = isBlockedEmail(email);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { data } = await api.post('/auth/forgot-password', { email });
      setSent(data.message);
    } catch (err) {
      setError(errorMessage(err, "Impossible d'envoyer le lien"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card auth-card">
      <h1>Mot de passe oublié</h1>
      {sent ? (
        <>
          <div role="status" className="alert alert-success">{sent}</div>
          <p className="muted small">
            Rien reçu après quelques minutes ? Vérifie l'adresse saisie ({email}) et tes spams, ou refais une demande.
          </p>
          <button type="button" className="btn btn-outline" onClick={() => setSent('')}>
            Refaire une demande
          </button>
        </>
      ) : (
        <>
          <p className="muted">Indique le mail perso de ton compte : tu vas recevoir un lien pour choisir un nouveau mot de passe.</p>
          <form onSubmit={handleSubmit} className="form">
            <label>
              Mail perso
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" spellCheck={false} autoFocus />
              {blocked && (
                <span className="field-help field-help-error">
                  Les adresses {BLOCKED_EMAIL_DOMAINS.map((d) => `@${d}`).join(' et ')} ne servent pas d'identifiant : indique
                  ton mail perso.
                </span>
              )}
            </label>
            {error && <div role="alert" className="alert alert-error">{error}</div>}
            <button type="submit" className="btn btn-primary" disabled={submitting || blocked}>
              {submitting ? 'Envoi…' : 'Recevoir le lien'}
            </button>
          </form>
        </>
      )}
      <p className="auth-switch">
        <Link to="/login">← Retour à la connexion</Link>
      </p>
    </div>
  );
}
