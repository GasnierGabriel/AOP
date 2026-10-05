import { useEffect, useState } from 'react';
import { errorMessage } from '../api';

const normalize = (text) => text.trim().replace(/\s+/g, ' ').toLowerCase();

// Confirmation de suppression définitive : il faut retaper le nom complet du membre
export default function DeleteMemberDialog({ member, onConfirm, onClose }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const handleKeyDown = (e) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [busy, onClose]);

  const matches = normalize(typed) === normalize(member.fullName);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!matches) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm();
    } catch (err) {
      setError(errorMessage(err, 'Impossible de supprimer ce compte'));
      setBusy(false);
    }
  };

  const competitions = member.competitions?.length || 0;
  const tags = member.tags?.length || 0;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-desc">
        <h2 id="delete-title">Supprimer le compte</h2>
        <div id="delete-desc" className="delete-warning">
          <p>
            Le compte de <strong>{member.fullName}</strong> ({member.email}) sera supprimé <strong>définitivement</strong>,
            avec :
          </p>
          <ul>
            <li>son profil (bio, réalisations) et son historique de rôles ;</li>
            <li>
              {competitions} compétition{competitions > 1 ? 's' : ''} et {tags} tag{tags > 1 ? 's' : ''} attribué
              {tags > 1 ? 's' : ''} ;
            </li>
            <li>ses sessions en cours (déconnexion immédiate).</li>
          </ul>
          <p>Cette action est irréversible (seule la sauvegarde quotidienne de la base permettrait de le retrouver).</p>
        </div>

        <form className="form" onSubmit={handleSubmit}>
          <label>
            Pour confirmer, tape le nom complet : {member.fullName}
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={member.fullName}
              autoComplete="off"
            />
          </label>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="modal-actions">
            <span className="spacer" />
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Annuler
            </button>
            <button type="submit" className="btn btn-danger-solid" disabled={!matches || busy}>
              {busy ? 'Suppression…' : 'Supprimer définitivement'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
