import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

// Guard de rutas. Sin sesión -> /login. Con `perm` (uno o varios, se exigen todos)
// valida los permisos en el cliente: el backend es la autoridad real; esto solo
// mejora la UX (como RequirePermission en db-keeper).
export function RequireAuth({ perm, children }) {
  const { user, loading, has } = useAuth();
  const location = useLocation();

  if (loading) return <div className="center muted">Cargando…</div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  const required = perm ? [].concat(perm) : [];
  if (!required.every((p) => has(p))) {
    return <div className="alert warn forbidden">No tienes permiso para esta sección. Pídele acceso a un administrador.</div>;
  }
  return children;
}
