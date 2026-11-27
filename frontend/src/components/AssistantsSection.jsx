import { useEffect, useRef, useState } from 'react';
import api, { errorMessage } from '../api';
import { formatDate } from '../utils';
import { useConfirm } from './ConfirmProvider';

// Copie dans le presse-papiers avec un retour « Copié », aussi annoncé aux lecteurs d'écran (zone role="status").
// Le bouton reste actif pendant le retour (copier deux fois est sans risque) ; un nouveau clic relance le délai.
function CopyButton({ text, label = 'Copier' }) {
  const [status, setStatus] = useState(''); // '', 'copied', 'failed'
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(text);
      setStatus('copied');
    } catch {
      setStatus('failed'); // presse-papiers indisponible (HTTP, permissions) : copie à la main
    }
    timer.current = setTimeout(() => setStatus(''), 2000);
  };
  return (
    <>
      <button type="button" className="btn btn-outline btn-sm" onClick={copy}>
        {status === 'copied' ? 'Copié ✓' : label}
      </button>
      <span role="status" className="sr-only">
        {status === 'copied' ? 'Copié dans le presse-papiers' : status === 'failed' ? 'Copie impossible, sélectionne le texte à la main' : ''}
      </span>
    </>
  );
}

// Assistants IA (serveur MCP) : adresse à donner à Claude / ChatGPT / Gemini, assistants connectés, jetons personnels
export default function AssistantsSection() {
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [hidden, setHidden] = useState(false);
  const [label, setLabel] = useState('');
  const [created, setCreated] = useState(null); // jeton affiché une seule fois
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .get('/mcp/acces')
      .then(({ data: d }) => setData(d))
      .catch((err) => (err.response?.status === 403 ? setHidden(true) : setError(errorMessage(err, 'Impossible de charger les accès'))));

  useEffect(() => {
    load();
  }, []);

  const run = async (action, fallback) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (app) =>
    (await confirm(`Déconnecter « ${app.name} » ? Il faudra l'autoriser à nouveau pour s'en servir.`, { title: 'Déconnecter l’assistant', confirmLabel: 'Déconnecter', danger: true })) &&
    run(async () => {
      await api.delete(`/mcp/apps/${encodeURIComponent(app.clientId)}`);
      await load();
    }, "Impossible de déconnecter l'assistant");

  const createToken = (e) => {
    e.preventDefault();
    run(async () => {
      const { data: d } = await api.post('/mcp/jetons', { label });
      setCreated(d.token);
      setLabel('');
      await load();
    }, 'Impossible de créer le jeton');
  };

  const revokeToken = async (t) =>
    (await confirm(`Révoquer le jeton « ${t.label} » ? Les outils qui l'utilisent perdront l'accès.`, { title: 'Révoquer le jeton', confirmLabel: 'Révoquer', danger: true })) &&
    run(async () => {
      await api.delete(`/mcp/jetons/${t.id}`);
      await load();
    }, 'Impossible de révoquer le jeton');

  if (hidden) return null; // compte pas encore validé
  if (!data) return error ? <div role="alert" className="alert alert-error">{error}</div> : null;

  return (
    <section className="card assistants">
      <h2>Assistants IA (MCP)</h2>
      <p className="muted">
        Connecte Claude, ChatGPT ou Gemini à Périclès pour consulter et mettre à jour les tâches,
        le wiki et, si tu y as accès, le sponsoring, en langage naturel. L'assistant agit avec tes droits et ne peut rien
        supprimer.
      </p>

      <div className="mcp-url">
        <span className="muted small">Adresse du serveur MCP</span>
        <code>{data.mcpUrl}</code>
        <CopyButton text={data.mcpUrl} />
      </div>

      <details className="mcp-howto">
        <summary>Comment l'ajouter à mon assistant ?</summary>
        <ul>
          <li>
            <strong>Claude</strong> (claude.ai, appli bureau ou mobile) : Paramètres → Connecteurs → Ajouter un connecteur
            personnalisé → colle l'adresse, puis « Se connecter ».
          </li>
          <li>
            <strong>ChatGPT</strong> : dans les paramètres des applications / connecteurs (mode développeur activé),
            crée un connecteur avec cette adresse et l'authentification OAuth.
          </li>
          <li>
            <strong>Gemini CLI / Antigravity / Claude Code</strong> : ajoute un serveur MCP distant (HTTP) avec cette
            adresse ; la connexion OAuth s'ouvre dans ton navigateur. Si l'outil ne gère pas OAuth, utilise un jeton
            personnel ci-dessous dans l'en-tête <code>Authorization: Bearer …</code>.
          </li>
        </ul>
        <p className="muted small">
          À la première utilisation, Périclès te demande d'autoriser l'assistant. Exemple de demande : « Quelles sont mes
          tâches en retard ? », « Résume la page du wiki sur le règlement FSUK » ou « Passe le partenaire Würth en
          négociation ».
        </p>
      </details>

      {error && <div role="alert" className="alert alert-error section-alert">{error}</div>}

      <h3>Assistants connectés</h3>
      {data.apps.length === 0 ? (
        <p className="muted small">Aucun assistant connecté pour l'instant.</p>
      ) : (
        <ul className="access-list">
          {data.apps.map((app) => (
            <li key={app.clientId}>
              <div>
                <strong>{app.name}</strong>
                <span className="muted small">
                  {' '}
                  · connecté le {formatDate(app.connectedAt)}
                  {app.lastUsedAt && ` · utilisé le ${formatDate(app.lastUsedAt)}`}
                </span>
              </div>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => disconnect(app)} disabled={busy}>
                Déconnecter
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3>Jetons personnels</h3>
      <p className="muted small">Pour les outils qui ne savent pas se connecter en OAuth. Valables 1 an, révocables à tout moment.</p>
      {created && (
        <div role="status" className="alert alert-success token-created">
          <span>Copie ce jeton maintenant : il ne sera plus jamais affiché.</span>
          <code>{created}</code>
          <span className="token-actions">
            <CopyButton text={created} label="Copier le jeton" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreated(null)}>
              C'est noté
            </button>
          </span>
        </div>
      )}
      {data.tokens.length > 0 && (
        <ul className="access-list">
          {data.tokens.map((t) => (
            <li key={t.id}>
              <div>
                <strong>{t.label}</strong>
                <span className="muted small">
                  {' '}
                  · créé le {formatDate(t.createdAt)} · expire le {formatDate(t.expiresAt)}
                  {t.lastUsedAt ? ` · utilisé le ${formatDate(t.lastUsedAt)}` : ' · jamais utilisé'}
                </span>
              </div>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => revokeToken(t)} disabled={busy}>
                Révoquer
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="token-form" onSubmit={createToken}>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Nom du jeton, ex : Gemini CLI sur mon PC"
          maxLength={100}
          required
          aria-label="Nom du jeton"
        />
        <button type="submit" className="btn btn-outline btn-sm" disabled={busy}>
          Créer un jeton
        </button>
      </form>
    </section>
  );
}
