import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, Link, useLocation } from 'react-router-dom';
import api, { TOKEN_KEY } from './api';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Annuaire from './pages/Annuaire';
import MemberDetail from './pages/MemberDetail';
import Profile from './pages/Profile';

// Logo officiel (blanc sur fond transparent), servi par le site vitrine
const LOGO_URL = 'https://arece.eu/images/ARECEV_FF_SVG_no_flag.png';

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
  return (
    <header className="navbar">
      <div className="navbar-inner">
        <Link to="/annuaire" className="navbar-brand">
          <img src={LOGO_URL} alt="ARECE" className="navbar-logo" />
        </Link>
        <nav className="navbar-links">
          {/* Les fiches membres font partie de l'annuaire */}
          <NavLink
            to="/annuaire"
            className={({ isActive }) => (isActive || pathname.startsWith('/member/') ? 'active' : undefined)}
          >
            Annuaire
          </NavLink>
          <NavLink to="/profile">Mon profil</NavLink>
        </nav>
        <div className="navbar-user">
          {session && <span className="navbar-name">{session.user.fullName}</span>}
          <button type="button" className="btn btn-outline btn-sm" onClick={onLogout}>
            Déconnexion
          </button>
        </div>
      </div>
      <Divider />
    </header>
  );
}

function PrivateRoute({ token, loading, children }) {
  if (!token) return <Navigate to="/login" replace />;
  if (loading) return <div className="loading">Chargement…</div>;
  return children;
}

function PublicOnlyRoute({ token, children }) {
  return token ? <Navigate to="/annuaire" replace /> : children;
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
      {token && <Navbar session={session} onLogout={handleLogout} />}
      <main className={token ? 'container' : 'auth-container'}>
        {!token && <img src={LOGO_URL} alt="ARECE" className="auth-logo" />}
        <Routes>
          <Route
            path="/login"
            element={<PublicOnlyRoute token={token}><Login onAuth={handleAuth} /></PublicOnlyRoute>}
          />
          <Route
            path="/signup"
            element={<PublicOnlyRoute token={token}><Signup onAuth={handleAuth} /></PublicOnlyRoute>}
          />
          <Route path="/annuaire" element={privateEl(<Annuaire />)} />
          <Route path="/member/:id" element={privateEl(<MemberDetail />)} />
          <Route path="/profile" element={privateEl(<Profile />)} />
          <Route path="*" element={<Navigate to={token ? '/annuaire' : '/login'} replace />} />
        </Routes>
      </main>
      {token && (
        <footer className="footer">
          <Divider />
          <p>ARECE · Autonomous Racing ECE · © {new Date().getFullYear()}</p>
        </footer>
      )}
    </BrowserRouter>
  );
}
