import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { errorMessage } from '../api';

// Étape OAuth : le membre connecté autorise (ou refuse) un assistant IA à accéder à l'ERP en son nom
export default function AutoriserAssistant({ session }) {
  const [params] = useSearchParams();
  const id = params.get('demande') || '';
  const [request, setRequest] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) {
      setError('Lien incomplet : relance la connexion depuis ton assistant.');
      return;
    }
    api
      .get(`/mcp/demandes/${encodeURIComponent(id)}`)
      .then(({ data }) => setRequest(data))
      .catch((err) => setError(errorMessage(err, 'Demande introuvable')));
  }, [id]);

  const answer = async (action) => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(`/mcp/demandes/${encodeURIComponent(id)}/${action}`);
      window.location.assign(data.redirect); // retour vers l'assistant, avec le code ou le refus
    } catch (err) {
      setError(errorMessage(err, 'Impossible de répondre à la demande'));
      setBusy(false);
    }
  };

  return (
    <div className="card auth-card consent-card">
      <h1>Autoriser un assistant</h1>
      {error && <div role="alert" className="alert alert-error">{error}</div>}
      {!error && !request && <p className="muted">Chargement…</p>}
      {request && (
        <>
          <p>
            <strong>{request.client.name}</strong> demande à accéder à Périclès au nom de{' '}
            <strong>{session?.user.fullName}</strong>.
          </p>
          <p className="muted small">
            Retour vers : <code>{request.client.redirectHost}</code>. Si tu n'as pas lancé cette connexion toi-même
            depuis ton assistant, refuse.
          </p>
          <ul className="consent-list">
            <li>✔ Consulter, créer, modifier, déplacer et commenter les tâches</li>
            <li>✔ Consulter, créer et modifier les pages du wiki (chaque modification reste dans l'historique)</li>
            {request.canSponsoring && <li>✔ Consulter et mettre à jour le sponsoring (partenaires, contacts, contreparties)</li>}
            <li>✘ Rien supprimer, ni accéder à tes informations de connexion</li>
          </ul>
          <p className="muted small">
            L'assistant agit avec tes droits. Tu pourras le déconnecter à tout moment dans{' '}
            <Link to="/connexion">Informations de connexion</Link>.
          </p>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => answer('refuser')} disabled={busy}>
              Refuser
            </button>
            <span className="spacer" />
            <button type="button" className="btn btn-primary" onClick={() => answer('accepter')} disabled={busy}>
              Autoriser
            </button>
          </div>
        </>
      )}
    </div>
  );
}
