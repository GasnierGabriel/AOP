import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errorMessage } from '../api';
import CompetitionsEditor from '../components/CompetitionsEditor';
import PromoSelect from '../components/PromoSelect';
import RolesEditor from '../components/RolesEditor';
import StatusBadge from '../components/StatusBadge';
import Email from '../components/Email';
import TagList from '../components/TagList';
import { initials } from '../utils';

const ASK_ARECE_LABELS = {
  full: 'Complet',
  limited: 'Limité (sans dossier bureau)',
  none: 'Aucun',
};

export default function Profile() {
  const [me, setMe] = useState(null);
  const [form, setForm] = useState({ bio: '', achievements: '', promo: null, linkedinUrl: '' });
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get('/auth/me')
      .then(({ data }) => {
        setMe(data);
        setForm({
          bio: data.user.profile.bio,
          achievements: data.user.profile.achievements,
          promo: data.user.promo,
          linkedinUrl: data.user.hasLinkedin ? data.user.linkedinUrl : '',
        });
      })
      .catch((err) => setLoadError(errorMessage(err, 'Impossible de charger ton profil')));
  }, []);

  const handleChange = (e) => {
    setSuccess(false);
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveError('');
    setSuccess(false);
    try {
      const { data } = await api.put('/annuaire/profile', form);
      setForm({
        bio: data.profile.bio,
        achievements: data.profile.achievements,
        promo: data.promo,
        linkedinUrl: data.hasLinkedin ? data.linkedinUrl : '',
      });
      setMe((prev) => ({
        ...prev,
        user: { ...prev.user, promo: data.promo, linkedinUrl: data.linkedinUrl, hasLinkedin: data.hasLinkedin },
      }));
      setSuccess(true);
    } catch (err) {
      setSaveError(errorMessage(err, "Échec de l'enregistrement"));
    } finally {
      setSaving(false);
    }
  };

  if (loadError) return <div role="alert" className="alert alert-error">{loadError}</div>;
  if (!me) return <div className="loading">Chargement…</div>;

  const { user, permissions } = me;
  const setUserField = (field) => (value) => setMe((prev) => ({ ...prev, user: { ...prev.user, [field]: value } }));

  return (
    <div className="detail">
      {user.status === 'prospect' && (
        <div role="status" className="alert alert-info">
          ⏳ Ton compte est en attente de validation par le bureau. Tu pourras accéder à l'annuaire une fois validé.
        </div>
      )}
      {user.emailNeedsUpdate && (
        <div role="status" className="alert alert-info">
          Ton compte utilise une adresse ARECE / ECE comme identifiant : renseigne ton mail perso dans{' '}
          <Link to="/connexion">Informations de connexion</Link>, sinon tu ne pourras plus te reconnecter.
        </div>
      )}

      <div className="card detail-header">
        <div className="avatar avatar-lg">{initials(user.fullName)}</div>
        <div className="detail-identity">
          <h1>{user.fullName}</h1>
          <StatusBadge status={user.status} isBureau={user.isBureau} />
          <TagList tags={user.tags} />
          <p className="muted">
            <Email address={user.email} />
            {user.promo && <> · Promo {user.promo}</>}
          </p>
          <p className="small">
            <Link to="/connexion">Informations de connexion →</Link>
          </p>
          {/* Le niveau d'accès n'est visible que par le bureau (l'API ne l'envoie qu'à lui) */}
          {user.isBureau && (
            <p className="muted small">
              Niveau d'accès {user.level} · Ask ARECE : {ASK_ARECE_LABELS[permissions.askArece]}
            </p>
          )}
        </div>
        {user.linkedinUrl && (
          <a className="btn btn-primary" href={user.linkedinUrl} target="_blank" rel="noopener noreferrer">
            LinkedIn ↗
          </a>
        )}
      </div>

      <div className="detail-grid">
        <section className="card">
          <h2>Mes rôles</h2>
          <RolesEditor memberId={user.id} roles={user.roles} onChange={setUserField('roles')} />
        </section>
        <section className="card">
          <h2>Mes compétitions</h2>
          <CompetitionsEditor
            memberId={user.id}
            competitions={user.competitions}
            onChange={setUserField('competitions')}
          />
        </section>
      </div>

      <form className="card form" onSubmit={handleSubmit}>
        <h2>Modifier mon profil</h2>
        <label>
          Promo
          <PromoSelect
            value={form.promo}
            onChange={(promo) => {
              setSuccess(false);
              setForm({ ...form, promo });
            }}
            className="promo-select"
          />
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
          Bio
          <textarea name="bio" rows={5} maxLength={5000} value={form.bio} onChange={handleChange} placeholder="Parcours, formation, centres d'intérêt…" />
        </label>
        <label>
          Réalisations
          <textarea
            name="achievements"
            rows={5}
            maxLength={5000}
            value={form.achievements}
            onChange={handleChange}
            placeholder="Projets menés, pièces conçues, résultats en compétition…"
          />
        </label>
        {success && <div role="status" className="alert alert-success">✅ Profil enregistré</div>}
        {saveError && <div role="alert" className="alert alert-error">{saveError}</div>}
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </form>
    </div>
  );
}
