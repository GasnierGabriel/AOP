import { useEffect, useState } from 'react';
import api, { errorMessage } from '../api';
import CompetitionsEditor from '../components/CompetitionsEditor';
import RolesEditor from '../components/RolesEditor';
import StatusBadge from '../components/StatusBadge';
import TagList from '../components/TagList';
import { initials } from '../utils';

const ASK_ARECE_LABELS = {
  full: 'Complet',
  limited: 'Limité (sans dossier bureau)',
  none: 'Aucun',
};

export default function Profile() {
  const [me, setMe] = useState(null);
  const [form, setForm] = useState({ bio: '', achievements: '' });
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get('/auth/me')
      .then(({ data }) => {
        setMe(data);
        setForm({ bio: data.user.profile.bio, achievements: data.user.profile.achievements });
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
      setForm({ bio: data.profile.bio, achievements: data.profile.achievements });
      setSuccess(true);
    } catch (err) {
      setSaveError(errorMessage(err, "Échec de l'enregistrement"));
    } finally {
      setSaving(false);
    }
  };

  if (loadError) return <div className="alert alert-error">{loadError}</div>;
  if (!me) return <div className="loading">Chargement…</div>;

  const { user, permissions } = me;
  const setUserField = (field) => (value) => setMe((prev) => ({ ...prev, user: { ...prev.user, [field]: value } }));

  return (
    <div className="detail">
      {user.status === 'prospect' && (
        <div className="alert alert-info">
          ⏳ Ton compte est en attente de validation par le bureau. Tu pourras accéder à l'annuaire une fois validé.
        </div>
      )}

      <div className="card detail-header">
        <div className="avatar avatar-lg">{initials(user.fullName)}</div>
        <div className="detail-identity">
          <h1>{user.fullName}</h1>
          <StatusBadge status={user.status} isBureau={user.isBureau} />
          <TagList tags={user.tags} />
          <p className="muted">
            {user.email}
            {user.promo && <> · Promo {user.promo}</>}
          </p>
          <p className="muted small">
            Niveau d'accès {user.level} · Ask ARECE : {ASK_ARECE_LABELS[permissions.askArece]}
          </p>
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
        {success && <div className="alert alert-success">✅ Profil enregistré</div>}
        {saveError && <div className="alert alert-error">{saveError}</div>}
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </form>
    </div>
  );
}
