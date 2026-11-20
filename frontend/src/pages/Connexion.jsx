import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { BLOCKED_EMAIL_DOMAINS, errorMessage, isBlockedEmail } from '../api';
import { GOOGLE_MESSAGES, GoogleIcon, googleLinkUrl, loadAuthConfig } from '../googleSso';
import AssistantsSection from '../components/AssistantsSection';
import { formatDate } from '../utils';

const BLOCKED_LIST = BLOCKED_EMAIL_DOMAINS.map((d) => `@${d}`).join(' ni ');

// Erreur de validation locale, au même format qu'une réponse d'erreur de l'API
const fail = (message) => {
  throw Object.assign(new Error(message), { response: { data: { error: message } } });
};

// Petit formulaire avec son propre état d'envoi / erreur / succès
function useFormState() {
  const [state, setState] = useState({ busy: false, error: '', success: '' });
  const run = async (action, fallback) => {
    setState({ busy: true, error: '', success: '' });
    try {
      const success = await action();
      setState({ busy: false, error: '', success });
      return true;
    } catch (err) {
      setState({ busy: false, error: errorMessage(err, fallback), success: '' });
      return false;
    }
  };
  return [state, run];
}

// Notifications par mail : relance quotidienne des tâches « À faire » en retard, récap du lundi
function NotificationsSection({ initial }) {
  const [prefs, setPrefs] = useState({
    taskReminders: initial?.taskReminders !== false,
    weeklyDigest: initial?.weeklyDigest !== false,
    taskAssigned: initial?.taskAssigned !== false,
  });
  const [state, run] = useFormState();
  const toggle = (key, value) =>
    run(async () => {
      const { data } = await api.put('/auth/notifications', { [key]: value });
      setPrefs(data.notifications);
      return 'Préférence enregistrée.';
    }, 'Impossible d’enregistrer la préférence');
  return (
    <section className="card">
      <h2>Notifications par mail</h2>
      <label className="checkbox-line">
        <input
          type="checkbox"
          checked={prefs.taskReminders}
          disabled={state.busy}
          onChange={(e) => toggle('taskReminders', e.target.checked)}
        />
        <span>
          Relance chaque matin si une de mes tâches est encore dans « À faire » alors que son échéance est passée
        </span>
      </label>
      <label className="checkbox-line">
        <input
          type="checkbox"
          checked={prefs.weeklyDigest}
          disabled={state.busy}
          onChange={(e) => toggle('weeklyDigest', e.target.checked)}
        />
        <span>Récap le lundi matin de mes tâches en cours (et de toutes les tâches pour le bureau)</span>
      </label>
      <label className="checkbox-line">
        <input
          type="checkbox"
          checked={prefs.taskAssigned}
          disabled={state.busy}
          onChange={(e) => toggle('taskAssigned', e.target.checked)}
        />
        <span>Mail quand quelqu'un m'assigne une tâche</span>
      </label>
      {state.error && <div className="alert alert-error section-alert">{state.error}</div>}
      {state.success && <p className="muted small">{state.success}</p>}
    </section>
  );
}

// Informations de connexion : mail perso, compte Google ARECE lié (SSO), mot de passe
export default function Connexion({ onSessionChange }) {
  const [params, setParams] = useSearchParams();
  const [me, setMe] = useState(null);
  const [google, setGoogle] = useState({ enabled: false, domain: 'arece.eu' });
  const [loadError, setLoadError] = useState('');

  const [emailForm, setEmailForm] = useState({ email: '', currentPassword: '' });
  const [emailState, runEmail] = useFormState();
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [passwordState, runPassword] = useFormState();
  const [googleState, runGoogle] = useFormState();

  const googleMessage = GOOGLE_MESSAGES[params.get('google')];

  const loadMe = () =>
    api
      .get('/auth/me')
      .then(({ data }) => setMe(data.user))
      .catch((err) => setLoadError(errorMessage(err, 'Impossible de charger tes informations')));

  useEffect(() => {
    loadMe();
    loadAuthConfig().then((config) => setGoogle(config.google));
  }, []);

  const changeEmail = (e) => {
    e.preventDefault();
    runEmail(async () => {
      if (isBlockedEmail(emailForm.email)) fail(`Utilise ton mail perso : pas d'adresse ${BLOCKED_LIST}.`);
      const { data } = await api.put('/auth/email', emailForm);
      setMe((prev) => ({ ...prev, email: data.user.email, emailNeedsUpdate: false }));
      setEmailForm({ email: '', currentPassword: '' });
      onSessionChange();
      return `Ton adresse de connexion est maintenant ${data.user.email}.`;
    }, "Impossible de changer l'adresse");
  };

  const changePassword = (e) => {
    e.preventDefault();
    runPassword(async () => {
      if (passwordForm.newPassword !== passwordForm.confirm) fail('Les mots de passe ne correspondent pas');
      const { data } = await api.put('/auth/password', {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordForm({ currentPassword: '', newPassword: '', confirm: '' });
      return data.otherSessionsClosed > 0
        ? `Mot de passe modifié. ${data.otherSessionsClosed} autre(s) session(s) ont été déconnectée(s).`
        : 'Mot de passe modifié.';
    }, 'Impossible de changer le mot de passe');
  };

  const linkGoogle = () =>
    runGoogle(async () => {
      const { data } = await api.post('/auth/google/link-ticket');
      window.location.assign(googleLinkUrl(data.ticket));
      return '';
    }, 'Impossible de lancer la liaison avec Google');

  const unlinkGoogle = () => {
    if (!window.confirm('Dissocier ton compte Google ? Tu devras te connecter avec ton mail perso et ton mot de passe.')) return;
    runGoogle(async () => {
      await api.delete('/auth/google');
      setMe((prev) => ({ ...prev, google: { linked: false, email: null, linkedAt: null } }));
      setParams({}, { replace: true });
      return 'Compte Google dissocié.';
    }, 'Impossible de dissocier le compte Google');
  };

  if (loadError) return <div className="alert alert-error">{loadError}</div>;
  if (!me) return <div className="loading">Chargement…</div>;

  return (
    <div className="detail connexion">
      <Link to="/profile" className="btn btn-ghost back">
        ← Mon profil
      </Link>
      <div className="page-header">
        <div>
          <h1>Informations de connexion</h1>
          <p className="muted">Comment tu te connectes à l'annuaire ARECE</p>
        </div>
      </div>

      {me.emailNeedsUpdate && (
        <div className="alert alert-info">
          Ton compte utilise encore l'adresse <strong>{me.email}</strong>. Les adresses {BLOCKED_LIST} ne permettent
          plus de se connecter par mot de passe : renseigne ton mail perso ci-dessous
          {google.enabled ? ', puis lie ton compte Google ARECE' : ''}.
        </div>
      )}

      <section className="card">
        <h2>Connexion Google ARECE</h2>
        {googleMessage && <div className={`alert alert-${googleMessage.type} section-alert`}>{googleMessage.text}</div>}
        {googleState.error && <div className="alert alert-error section-alert">{googleState.error}</div>}
        {googleState.success && <div className="alert alert-success section-alert">{googleState.success}</div>}

        {me.google.linked ? (
          <div className="google-status">
            <GoogleIcon />
            <div className="google-status-text">
              <strong>{me.google.email}</strong>
              <span className="muted small">Lié le {formatDate(me.google.linkedAt)} · connexion en un clic avec Google</span>
            </div>
            <button type="button" className="btn btn-danger btn-sm" onClick={unlinkGoogle} disabled={googleState.busy}>
              Dissocier
            </button>
          </div>
        ) : google.enabled ? (
          <div className="google-status">
            <p className="muted">
              Lie ton compte Google <strong>@{google.domain}</strong> pour te connecter ensuite en un clic, sans mot de
              passe.
            </p>
            <button type="button" className="btn btn-google" onClick={linkGoogle} disabled={googleState.busy}>
              <GoogleIcon />
              Lier mon compte Google ARECE
            </button>
          </div>
        ) : (
          <p className="muted">
            La connexion avec Google (@{google.domain}) n'est pas encore activée sur l'annuaire. Elle apparaîtra ici dès
            qu'elle sera configurée.
          </p>
        )}
      </section>

      <div className="detail-grid">
        <section className="card">
          <h2>Mail perso</h2>
          <p className="current-value">
            <span className="muted small">Adresse de connexion actuelle</span>
            <strong>{me.email}</strong>
          </p>
          <form className="form connexion-form" onSubmit={changeEmail}>
            <label>
              Nouveau mail perso
              <input
                type="email"
                value={emailForm.email}
                onChange={(e) => setEmailForm({ ...emailForm, email: e.target.value })}
                placeholder="prenom.nom@gmail.com"
                required
                autoComplete="email"
              />
            </label>
            <label>
              Mot de passe actuel
              <input
                type="password"
                value={emailForm.currentPassword}
                onChange={(e) => setEmailForm({ ...emailForm, currentPassword: e.target.value })}
                required
                autoComplete="current-password"
              />
            </label>
            {emailState.error && <div className="alert alert-error">{emailState.error}</div>}
            {emailState.success && <div className="alert alert-success">{emailState.success}</div>}
            <button type="submit" className="btn btn-primary" disabled={emailState.busy}>
              Changer d'adresse
            </button>
          </form>
        </section>

        <section className="card">
          <h2>Mot de passe</h2>
          <form className="form connexion-form" onSubmit={changePassword}>
            <label>
              Mot de passe actuel
              <input
                type="password"
                value={passwordForm.currentPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                required
                autoComplete="current-password"
              />
            </label>
            <label>
              Nouveau mot de passe
              <input
                type="password"
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </label>
            <label>
              Confirmer le nouveau mot de passe
              <input
                type="password"
                value={passwordForm.confirm}
                onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
                required
                autoComplete="new-password"
              />
            </label>
            {passwordState.error && <div className="alert alert-error">{passwordState.error}</div>}
            {passwordState.success && <div className="alert alert-success">{passwordState.success}</div>}
            <button type="submit" className="btn btn-primary" disabled={passwordState.busy}>
              Changer le mot de passe
            </button>
          </form>
        </section>
      </div>

      <NotificationsSection initial={me.notifications} />

      <AssistantsSection />
    </div>
  );
}
