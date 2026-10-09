import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { BLOCKED_EMAIL_DOMAINS, errorMessage, isBlockedEmail } from '../api';
import PromoSelect from '../components/PromoSelect';

const LINKEDIN_RE = /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/.+/i;
const BLOCKED_LIST = BLOCKED_EMAIL_DOMAINS.map((d) => `@${d}`).join(' ni ');

export default function Signup({ onAuth }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    linkedinUrl: '',
    promo: null,
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (form.password.length < 8) {
      return setError('Le mot de passe doit contenir au moins 8 caractères');
    }
    if (form.password !== form.confirmPassword) {
      return setError('Les mots de passe ne correspondent pas');
    }
    if (isBlockedEmail(form.email)) {
      return setError(`Utilise ton mail perso : pas d'adresse ${BLOCKED_LIST}.`);
    }
    // LinkedIn facultatif, vérifié seulement s'il est renseigné
    if (form.linkedinUrl.trim() && !LINKEDIN_RE.test(form.linkedinUrl.trim())) {
      return setError('URL LinkedIn invalide (ex : https://www.linkedin.com/in/ton-profil)');
    }

    setSubmitting(true);
    try {
      const { data } = await api.post('/auth/signup', {
        fullName: form.full_name,
        email: form.email,
        linkedinUrl: form.linkedinUrl,
        promo: form.promo,
        password: form.password,
      });
      onAuth(data.token);
      navigate('/annuaire');
    } catch (err) {
      setError(errorMessage(err, 'Inscription impossible'));
      setSubmitting(false);
    }
  };

  return (
    <div className="card auth-card">
      <h1>Créer un compte</h1>
      <p className="muted">Ton compte sera validé par le bureau avant d'accéder à l'annuaire.</p>
      <form onSubmit={handleSubmit} className="form">
        <label>
          Nom complet
          <input name="full_name" value={form.full_name} onChange={handleChange} required autoComplete="name" />
        </label>
        <label>
          Mail perso
          <input
            type="email"
            name="email"
            value={form.email}
            onChange={handleChange}
            placeholder="prenom.nom@gmail.com"
            required
            autoComplete="email"
            aria-describedby="email-help"
          />
          <span id="email-help" className={`field-help ${isBlockedEmail(form.email) ? 'field-help-error' : ''}`}>
            Pas d'adresse {BLOCKED_LIST} : ton compte Google ARECE pourra être lié ensuite pour te connecter en un clic.
          </span>
        </label>
        <label>
          Profil LinkedIn (facultatif)
          <input
            type="url"
            name="linkedinUrl"
            value={form.linkedinUrl}
            onChange={handleChange}
            placeholder="https://www.linkedin.com/in/ton-profil"
          />
        </label>
        <label>
          Promo
          <PromoSelect
            value={form.promo}
            onChange={(promo) => setForm({ ...form, promo })}
            emptyLabel="Choisis ta promo (facultatif)"
          />
        </label>
        <label>
          Mot de passe
          <input type="password" name="password" value={form.password} onChange={handleChange} required minLength={8} autoComplete="new-password" />
        </label>
        <label>
          Confirmer le mot de passe
          <input type="password" name="confirmPassword" value={form.confirmPassword} onChange={handleChange} required autoComplete="new-password" />
        </label>
        {error && <div className="alert alert-error">{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Création…' : 'Créer mon compte'}
        </button>
      </form>
      <p className="auth-switch">
        Déjà membre ? <Link to="/login">Se connecter</Link>
      </p>
    </div>
  );
}
