import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api/client.js';
import { IconServer } from '../components/icons.jsx';

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
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <h1 className="login-brand"><IconServer /> db-refresh</h1>
        <p className="muted">Inicia sesión para continuar</p>

        <label>
          {methods.ad ? 'Usuario o email' : 'Email'}
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={methods.ad ? 'DOMINIO\\usuario o tu@email' : 'tu@email'}
            autoFocus
            required
          />
          {methods.ad && (
            <span className="field-hint">Cuentas de Active Directory: tu usuario de red, con o sin dominio.</span>
          )}
        </label>
        <label>
          Contraseña
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <div className="alert error">{error}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  );
}
