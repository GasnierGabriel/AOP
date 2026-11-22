import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api, { errorMessage } from '../api';
import { CompetitionList, RoleTimeline } from '../components/CareerLists';
import CompetitionsEditor from '../components/CompetitionsEditor';
import MemberTags from '../components/MemberTags';
import RolesEditor from '../components/RolesEditor';
import StatusBadge from '../components/StatusBadge';
import Email from '../components/Email';
import TagList from '../components/TagList';
import { initials } from '../utils';

export default function MemberDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [member, setMember] = useState(null);
  const [canManageTags, setCanManageTags] = useState(false);
  const [canEditCareer, setCanEditCareer] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setMember(null);
    setError('');
    api
      .get(`/annuaire/members/${id}`)
      .then(({ data }) => {
        setMember(data.member);
        setCanManageTags(data.canManageTags);
        setCanEditCareer(data.canEditCareer);
      })
      .catch((err) => setError(errorMessage(err, 'Impossible de charger ce membre')));
  }, [id]);

  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/annuaire'));

  return (
    <>
      <button type="button" className="btn btn-ghost back" onClick={goBack}>
        ← Retour
      </button>

      {error && <div role="alert" className="alert alert-error">{error}</div>}
      {!error && !member && <div className="loading" role="status">Chargement…</div>}

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
                <Email address={member.email} link />
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
              {canEditCareer ? (
                <RolesEditor
                  memberId={member.id}
                  roles={member.roles}
                  onChange={(roles) => setMember((prev) => ({ ...prev, roles }))}
                />
              ) : (
                <RoleTimeline roles={member.roles} />
              )}
            </section>
            <section className="card">
              <h2>Compétitions</h2>
              {canEditCareer ? (
                <CompetitionsEditor
                  memberId={member.id}
                  competitions={member.competitions}
                  onChange={(competitions) => setMember((prev) => ({ ...prev, competitions }))}
                />
              ) : (
                <CompetitionList competitions={member.competitions} />
              )}
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
