import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { errorMessage } from '../api';

export default function Login({ onAuth }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { data } = await api.post('/auth/login', form);
      onAuth(data.token);
      navigate('/annuaire');
    } catch (err) {
      setError(errorMessage(err, 'Connexion impossible'));
      setSubmitting(false);
    }
  };

  return (
    <div className="card auth-card">
      <h1>Connexion</h1>
      <p className="muted">Annuaire des membres ARECE</p>
      <form onSubmit={handleSubmit} className="form">
        <label>
          Email
          <input type="email" name="email" value={form.email} onChange={handleChange} required autoComplete="email" />
        </label>
        <label>
          Mot de passe
          <input type="password" name="password" value={form.password} onChange={handleChange} required autoComplete="current-password" />
        </label>
        {error && <div className="alert alert-error">{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
      <p className="auth-switch">
        Pas encore de compte ? <Link to="/signup">Créer un compte</Link>
      </p>
    </div>
  );
}
