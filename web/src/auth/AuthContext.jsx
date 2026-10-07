import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  // Login único: email (local) o cuenta de red (AD); el backend decide el tipo.
  const login = async (username, password) => {
    const d = await api.post('/auth/login', { username, password });
    setUser(d.user);
    return d.user;
  };

  const logout = async () => {
    await api.post('/auth/logout');
    setUser(null);
  };

  // Vuelve a leer la identidad (p.ej. tras editar el perfil).
  const refresh = useCallback(() => api.get('/auth/me').then((d) => setUser(d.user)), []);

  // RBAC (como db-keeper): `has('tasks:run')`. Los permisos vienen del servidor
  // (/auth/me y login); el backend vuelve a comprobarlos en cada petición.
  const permissions = useMemo(() => new Set(user?.permissions ?? []), [user]);
  const has = useCallback((perm) => permissions.has(perm), [permissions]);

  return (
    <AuthCtx.Provider value={{ user, loading, login, logout, refresh, has }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
