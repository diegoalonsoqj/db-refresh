import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

// Guard de rutas. Sin sesión -> /login. Con `roles`, valida RBAC en cliente
// (el backend es la autoridad real; esto solo mejora la UX).
export function RequireAuth({ roles, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="center muted">Cargando…</div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (roles && !roles.includes(user.role)) {
    return <div className="center muted">No tienes permiso para esta sección.</div>;
  }
  return children;
}
