import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api/client.js';
import { BrandLogo } from '../components/icons.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';

/** Inicio de sesión (mismo diseño que db-keeper): login único local o AD, el servidor decide. */
export default function LoginPage() {
  const { user, login } = useAuth();
  const [methods, setMethods] = useState({ local: true, ad: false });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    api.get('/auth/methods').then(setMethods).catch(() => {});
  }, []);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } catch (err) {
      setError(err.status === 401 ? 'Credenciales inválidas' : err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="card login-card" onSubmit={submit}>
        <h1 className="login-brand"><BrandLogo size={48} /> DBRefresh</h1>
        <p className="login-tagline">Restauración, programación y monitoreo de backups en Cloud SQL</p>

        <label>
          Usuario
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            required
          />
          {methods.ad && (
            <span className="field-hint">Active Directory: tu usuario de red, sin dominio. Cuentas locales: tu email.</span>
          )}
        </label>
        <label>
          Contraseña
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <div className="alert error">{error}</div>}
        <button className="btn primary login-submit" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>

        <div className="login-foot">
          <ThemeToggle className="login-theme" />
        </div>
      </form>
    </div>
  );
}
