import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api, { errorMessage } from '../api';
import StatusBadge from '../components/StatusBadge';
import MemberTags from '../components/MemberTags';
import TagList from '../components/TagList';
import { formatDate, initials } from '../utils';

export function RoleTimeline({ roles }) {
  if (roles.length === 0) return <p className="muted">Aucun rôle enregistré.</p>;
  return (
    <ol className="timeline">
      {roles.map((role) => (
        <li key={role.id} className={role.isCurrent ? 'timeline-current' : ''}>
          <div className="timeline-title">
            {role.name}
            {role.pole && <span className="muted"> · {role.pole}</span>}
            {role.isCurrent && <span className="chip chip-primary small">Actuel</span>}
          </div>
          <div className="muted small">
            {formatDate(role.startDate)} → {role.endDate ? formatDate(role.endDate) : "aujourd'hui"}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function CompetitionList({ competitions }) {
  if (competitions.length === 0) return <p className="muted">Aucune compétition.</p>;
  return (
    <ul className="competition-list">
      {competitions.map((c) => (
        <li key={c.id}>
          <strong>{c.name}</strong>
          {c.role && <span className="chip">{c.role}</span>}
        </li>
      ))}
    </ul>
  );
}

export default function MemberDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [member, setMember] = useState(null);
  const [canManageTags, setCanManageTags] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setMember(null);
    setError('');
    api
      .get(`/annuaire/members/${id}`)
      .then(({ data }) => {
        setMember(data.member);
        setCanManageTags(data.canManageTags);
      })
      .catch((err) => setError(errorMessage(err, 'Impossible de charger ce membre')));
  }, [id]);

  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/annuaire'));

  return (
    <>
      <button type="button" className="btn btn-ghost back" onClick={goBack}>
        ← Retour
      </button>

      {error && <div className="alert alert-error">{error}</div>}
      {!error && !member && <div className="loading">Chargement…</div>}

      {member && (
        <div className="detail">
          <div className="card detail-header">
            <div className="avatar avatar-lg">{initials(member.fullName)}</div>
            <div className="detail-identity">
              <h1>{member.fullName}</h1>
              <StatusBadge status={member.status} isBureau={member.isBureau} />
              {canManageTags ? (
                <MemberTags
                  memberId={member.id}
                  tags={member.tags}
                  onChange={(tags) => setMember((prev) => ({ ...prev, tags }))}
                />
              ) : (
                <TagList tags={member.tags} />
              )}
              <p className="muted">
                <a href={`mailto:${member.email}`}>{member.email}</a>
                {member.promo && <> · Promo {member.promo}</>}
              </p>
            </div>
            {member.linkedinUrl && (
              <a className="btn btn-primary" href={member.linkedinUrl} target="_blank" rel="noopener noreferrer">
                LinkedIn ↗
              </a>
            )}
          </div>

          <div className="detail-grid">
            <section className="card">
              <h2>Rôles</h2>
              <RoleTimeline roles={member.roles} />
            </section>
            <section className="card">
              <h2>Compétitions</h2>
              <CompetitionList competitions={member.competitions} />
            </section>
            <section className="card">
              <h2>Bio</h2>
              <p className="prewrap">{member.profile.bio || <span className="muted">Pas encore de bio.</span>}</p>
            </section>
            <section className="card">
              <h2>Réalisations</h2>
              <p className="prewrap">
                {member.profile.achievements || <span className="muted">Rien de renseigné pour l'instant.</span>}
              </p>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
