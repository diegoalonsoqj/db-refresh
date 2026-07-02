import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api/client.js';

export default function LoginPage() {
  const { user, login } = useAuth();
  const [methods, setMethods] = useState({ local: true, ad: false });
  const [source, setSource] = useState('local');
  const [email, setEmail] = useState('');
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
      await login(email, password, source);
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } catch (err) {
      setError(err.status === 401 ? 'Credenciales inválidas' : err.message);
    } finally {
      setBusy(false);
    }
  };

  const isAd = source === 'ad';

  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <h1>🗄️ db-refresh</h1>
        <p className="muted">Inicia sesión para continuar</p>

        {methods.ad && (
          <div className="tabs" style={{ marginBottom: 0 }}>
            <button type="button" className={!isAd ? 'active' : ''} onClick={() => setSource('local')}>Local</button>
            <button type="button" className={isAd ? 'active' : ''} onClick={() => setSource('ad')}>Active Directory</button>
          </div>
        )}

        <label>
          {isAd ? 'Usuario' : 'Email'}
          <input
            type={isAd ? 'text' : 'email'}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={isAd ? 'usuario o usuario@dominio' : ''}
            autoFocus
            required
          />
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
