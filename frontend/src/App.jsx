import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, Link, useLocation } from 'react-router-dom';
import api, { TOKEN_KEY } from './api';
import ErrorBoundary from './components/ErrorBoundary';
import { ConfirmProvider } from './components/ConfirmProvider';
import Login from './pages/Login';

// Pages chargées à la demande : la première visite ne télécharge que ce qui est affiché
const MotDePasseOublie = lazy(() => import('./pages/MotDePasseOublie'));
const ReinitialiserMotDePasse = lazy(() => import('./pages/ReinitialiserMotDePasse'));
const Signup = lazy(() => import('./pages/Signup'));
const Annuaire = lazy(() => import('./pages/Annuaire'));
const MemberDetail = lazy(() => import('./pages/MemberDetail'));
const Profile = lazy(() => import('./pages/Profile'));
const Gestion = lazy(() => import('./pages/Gestion'));
const Connexion = lazy(() => import('./pages/Connexion'));
const GoogleCallback = lazy(() => import('./pages/GoogleCallback'));
const Sponsoring = lazy(() => import('./pages/Sponsoring'));
const Taches = lazy(() => import('./pages/Taches'));
const AutoriserAssistant = lazy(() => import('./pages/AutoriserAssistant'));
const Wiki = lazy(() => import('./pages/Wiki'));
const WikiPage = lazy(() => import('./pages/WikiPage'));
const WikiEditor = lazy(() => import('./pages/WikiEditor'));
const Galerie = lazy(() => import('./pages/Galerie'));
const GalerieAlbum = lazy(() => import('./pages/GalerieAlbum'));

// Titre de l'onglet selon la page (les pages du wiki le précisent ensuite avec leur propre titre)
const PAGE_TITLES = [
  [/^\/login/, 'Connexion'],
  [/^\/signup/, 'Inscription'],
  [/^\/mot-de-passe-oublie/, 'Mot de passe oublié'],
  [/^\/reinitialiser-mot-de-passe/, 'Nouveau mot de passe'],
  [/^\/annuaire/, 'Annuaire'],
  [/^\/member\//, 'Fiche membre'],
  [/^\/profile/, 'Mon profil'],
  [/^\/connexion/, 'Informations de connexion'],
  [/^\/taches/, 'Tâches'],
  [/^\/sponsoring/, 'Sponsoring'],
  [/^\/gestion/, 'Gestion'],
  [/^\/wiki/, 'Wiki'],
  [/^\/galerie/, 'Galerie'],
  [/^\/autoriser-assistant/, 'Autoriser un assistant'],
];
function PageTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const match = PAGE_TITLES.find(([re]) => re.test(pathname));
    document.title = match ? `${match[1]} · ERP ARECE` : 'ERP ARECE';
  }, [pathname]);
  return null;
}

// Les erreurs d'affichage d'une page ne font pas tomber tout le site ; elles s'effacent en changeant de page
function PageBoundary({ children }) {
  const { pathname } = useLocation();
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>;
}

// Logo officiel (blanc sur fond transparent), servi par l'ERP lui-même (dimensions connues : pas de saut de mise en page)
const LOGO_URL = '/logo-arece.png';
const LOGO_SIZE = { width: 441, height: 268 };

// Filet blanc + rouge, repris du site arece.eu
function Divider() {
  return (
    <div className="divider" aria-hidden="true">
      <span className="divider-white" />
      <span className="divider-red" />
    </div>
  );
}

function Navbar({ session, onLogout }) {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false); // menu déroulant sur mobile
  const isBureau = session?.user.isBureau;
  const isMember = session?.permissions.canViewDirectory;
  const canSponsoring = session?.permissions.canAccessSponsoring;
  const canGallery = session?.permissions.canViewGallery;
  const pending = session?.permissions.pendingProspects || 0;
  const urgentCounterparts = (canSponsoring && session?.permissions.urgentCounterparts) || 0;
  const myUrgentTasks = session?.permissions.myUrgentTasks || 0;

  const headerRef = useRef(null);
  const toggleRef = useRef(null);

  useEffect(() => setMenuOpen(false), [pathname]);

  // Menu mobile ouvert : Échap le ferme (focus rendu au bouton ☰), un clic ailleurs aussi
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      toggleRef.current?.focus();
    };
    const onPointerDown = (e) => {
      if (!headerRef.current?.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [menuOpen]);

  return (
    <header ref={headerRef} className={`navbar ${menuOpen ? 'menu-open' : ''}`}>
      <div className="navbar-inner">
        <Link to="/annuaire" className="navbar-brand">
          <img src={LOGO_URL} {...LOGO_SIZE} alt="ARECE, retour à l’annuaire" className="navbar-logo" />
        </Link>
        <button
          ref={toggleRef}
          type="button"
          className="menu-toggle"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-controls="main-nav"
          aria-label={menuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
        >
          <span aria-hidden="true">{menuOpen ? '✕' : '☰'}</span>
          {pending + urgentCounterparts + myUrgentTasks > 0 && !menuOpen && <span className="menu-toggle-dot" aria-hidden="true" />}
        </button>
        <nav id="main-nav" className="navbar-links">
          {/* Les fiches membres font partie de l'annuaire */}
          <NavLink
            to="/annuaire"
            className={({ isActive }) => (isActive || pathname.startsWith('/member/') ? 'active' : undefined)}
          >
            Annuaire
          </NavLink>
          {isMember && (
            <NavLink to="/taches">
              Tâches
              {myUrgentTasks > 0 && (
                <>
                  <span className="nav-badge" title={`${myUrgentTasks} de tes tâches en retard ou à échéance sous 3 jours`} aria-hidden="true">
                    {myUrgentTasks}
                  </span>
                  <span className="sr-only"> ({`${myUrgentTasks} de tes tâches en retard ou à échéance sous 3 jours`})</span>
                </>
              )}
            </NavLink>
          )}
          {isMember && <NavLink to="/wiki">Wiki</NavLink>}
          {canGallery && <NavLink to="/galerie">Galerie</NavLink>}
          <NavLink to="/profile">Mon profil</NavLink>
          {canSponsoring && (
            <NavLink to="/sponsoring">
              Sponsoring
              {urgentCounterparts > 0 && (
                <>
                  <span className="nav-badge" title={`${urgentCounterparts} contrepartie(s) en retard ou à échéance sous 7 jours`} aria-hidden="true">
                    {urgentCounterparts}
                  </span>
                  <span className="sr-only"> ({`${urgentCounterparts} contrepartie(s) en retard ou à échéance sous 7 jours`})</span>
                </>
              )}
            </NavLink>
          )}
          {isBureau && (
            <NavLink to="/gestion">
              Gestion
              {pending > 0 && (
                <>
                  <span className="nav-badge" title={`${pending} inscription(s) en attente`} aria-hidden="true">
                    {pending}
                  </span>
                  <span className="sr-only"> ({`${pending} inscription(s) en attente`})</span>
                </>
              )}
            </NavLink>
          )}
          {/* Dans le menu ☰ (écrans étroits), le nom masqué de la barre reste accessible ici */}
          {session && (
            <NavLink to="/connexion" className={({ isActive }) => `nav-account${isActive ? ' active' : ''}`}>
              <span className="nav-account-name">{session.user.fullName}</span>
              <span className="sr-only">, </span>
              <span className="nav-account-hint">Informations de connexion</span>
            </NavLink>
          )}
        </nav>
        <div className="navbar-user">
          {session && (
            <Link to="/connexion" className="navbar-name" title={`${session.user.fullName} · Informations de connexion`}>
              {session.user.fullName}
            </Link>
          )}
          <button type="button" className="btn btn-outline btn-sm" onClick={onLogout} aria-label="Déconnexion">
            <span className="label-long">Déconnexion</span>
            <span className="label-short" aria-hidden="true">⏻</span>
          </button>
        </div>
      </div>
      <Divider />
    </header>
  );
}

function PrivateRoute({ token, loading, children }) {
  const location = useLocation();
  // Après connexion, retour à la page demandée (ex : autorisation d'un assistant IA)
  if (!token) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  if (loading) return <div className="loading" role="status">Chargement…</div>;
  return children;
}

function PublicOnlyRoute({ token, children }) {
  return token ? <Navigate to="/annuaire" replace /> : children;
}

// Pages réservées au bureau (l'API vérifie aussi les droits)
function BureauRoute({ session, children }) {
  return session?.user.isBureau ? children : <Navigate to="/annuaire" replace />;
}

// Wiki : tous les membres validés (pas les prospects)
function MemberRoute({ session, children }) {
  return session?.permissions.canViewDirectory ? children : <Navigate to="/annuaire" replace />;
}

// Galerie : bureau, actifs, alumni, honoraires L2 (droit calculé par l'API)
function GalleryRoute({ session, children }) {
  return session?.permissions.canViewGallery ? children : <Navigate to="/annuaire" replace />;
}

// Sponsoring : bureau ou membres tagués « Sponsoring » (droit calculé par l'API)
function SponsoringRoute({ session, children }) {
  return session?.permissions.canAccessSponsoring ? children : <Navigate to="/annuaire" replace />;
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [session, setSession] = useState(null); // réponse de GET /auth/me
  const [loading, setLoading] = useState(Boolean(token));

  useEffect(() => {
    if (!token) {
      setSession(null);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    api
      .get('/auth/me')
      .then((res) => !cancelled && setSession(res.data))
      .catch(() => !cancelled && setSession(null)) // 401 géré par l'intercepteur
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Recharge la session (droits, compteur d'inscriptions en attente) après une modification d'accès
  const refreshSession = () =>
    api
      .get('/auth/me')
      .then((res) => setSession(res.data))
      .catch(() => {});

  const handleAuth = (newToken) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    setLoading(true);
    setToken(newToken);
  };

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // le token est supprimé localement dans tous les cas
    }
    localStorage.removeItem(TOKEN_KEY);
    setSession(null);
    setToken(null);
  };

  const privateEl = (element) => (
    <PrivateRoute token={token} loading={loading}>
      {element}
    </PrivateRoute>
  );

  return (
    <BrowserRouter>
      <ConfirmProvider>
        <PageTitle />
        <a href="#contenu" className="skip-link">
          Aller au contenu
        </a>
        {token && <Navbar session={session} onLogout={handleLogout} />}
        <main id="contenu" tabIndex={-1} className={token ? 'container' : 'auth-container'}>
          {!token && <img src={LOGO_URL} {...LOGO_SIZE} alt="ARECE" className="auth-logo" />}
          <PageBoundary>
            <Suspense fallback={<div className="loading" role="status">Chargement…</div>}>
              <Routes>
                <Route
                  path="/login"
                  element={<PublicOnlyRoute token={token}><Login onAuth={handleAuth} /></PublicOnlyRoute>}
                />
                {/* Retour de la connexion Google (jeton dans le fragment de l'URL) */}
                <Route path="/login/google" element={<GoogleCallback onAuth={handleAuth} />} />
                <Route path="/mot-de-passe-oublie" element={<PublicOnlyRoute token={token}><MotDePasseOublie /></PublicOnlyRoute>} />
                {/* Lien reçu par mail : accessible même connecté (le nouveau mot de passe ouvre une nouvelle session) */}
                <Route path="/reinitialiser-mot-de-passe" element={<ReinitialiserMotDePasse onAuth={handleAuth} />} />
                <Route
                  path="/signup"
                  element={<PublicOnlyRoute token={token}><Signup onAuth={handleAuth} /></PublicOnlyRoute>}
                />
                <Route path="/annuaire" element={privateEl(<Annuaire />)} />
                <Route path="/member/:id" element={privateEl(<MemberDetail />)} />
                <Route path="/profile" element={privateEl(<Profile />)} />
                <Route path="/connexion" element={privateEl(<Connexion onSessionChange={refreshSession} />)} />
                <Route
                  path="/taches"
                  element={privateEl(
                    <MemberRoute session={session}>
                      <Taches session={session} onSessionChange={refreshSession} />
                    </MemberRoute>
                  )}
                />
                <Route
                  path="/autoriser-assistant"
                  element={privateEl(
                    <MemberRoute session={session}>
                      <AutoriserAssistant session={session} />
                    </MemberRoute>
                  )}
                />
                <Route path="/wiki" element={privateEl(<MemberRoute session={session}><Wiki /></MemberRoute>)} />
                <Route path="/wiki/c/:slug" element={privateEl(<MemberRoute session={session}><Wiki /></MemberRoute>)} />
                <Route path="/wiki/nouveau" element={privateEl(<MemberRoute session={session}><WikiEditor /></MemberRoute>)} />
                <Route path="/wiki/p/:slug" element={privateEl(<MemberRoute session={session}><WikiPage /></MemberRoute>)} />
                <Route
                  path="/wiki/p/:slug/modifier"
                  element={privateEl(<MemberRoute session={session}><WikiEditor /></MemberRoute>)}
                />
                <Route path="/galerie" element={privateEl(<GalleryRoute session={session}><Galerie /></GalleryRoute>)} />
                <Route path="/galerie/:albumId" element={privateEl(<GalleryRoute session={session}><GalerieAlbum /></GalleryRoute>)} />
                <Route
                  path="/sponsoring"
                  element={privateEl(
                    <SponsoringRoute session={session}>
                      <Sponsoring session={session} onSessionChange={refreshSession} />
                    </SponsoringRoute>
                  )}
                />
                <Route
                  path="/gestion"
                  element={privateEl(
                    <BureauRoute session={session}>
                      <Gestion session={session} onSessionChange={refreshSession} />
                    </BureauRoute>
                  )}
                />
                <Route path="*" element={<Navigate to={token ? '/annuaire' : '/login'} replace />} />
              </Routes>
            </Suspense>
          </PageBoundary>
        </main>
        {token && (
          <footer className="footer">
            <Divider />
            <p>ARECE · Autonomous Racing ECE · © {new Date().getFullYear()}</p>
          </footer>
        )}
      </ConfirmProvider>
    </BrowserRouter>
  );
}
