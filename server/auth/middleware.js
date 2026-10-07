// Middleware de autenticación (JWT en cookie httpOnly) y autorización por permisos
// (RBAC granular, como db-keeper).
import { verifyToken } from './jwt.js';
import { AuthError, ForbiddenError } from '../domain/errors.js';
import { getUserById } from '../data/repositories/users.repo.js';
import { getUserAccess } from '../data/repositories/rbac.repo.js';
import { hasAll } from '../domain/permissions.js';

export const AUTH_COOKIE = 'session';

/** Extrae el token de la cookie httpOnly (o del header Bearer como alternativa). */
function extractToken(req) {
  const fromCookie = req.cookies?.[AUTH_COOKIE];
  if (fromCookie) return fromCookie;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

/**
 * Exige sesión válida y resuelve la identidad DESDE LA BD en cada petición:
 * req.user = { id, email, username, roles: [claves], permissions: Set }.
 * Un usuario desactivado o eliminado pierde el acceso al momento, y un cambio de
 * roles/permisos aplica sin volver a iniciar sesión.
 */
export async function authenticate(req, _res, next) {
  try {
    const token = extractToken(req);
    if (!token) throw new AuthError('Sesión requerida', { code: 'NO_SESSION' });
    const payload = verifyToken(token);
    const user = await getUserById(payload.sub);
    if (!user || !user.is_active) throw new AuthError('Sesión inválida o usuario desactivado', { code: 'INVALID_SESSION' });
    const { roles, permissions } = await getUserAccess(user.id);
    req.user = { id: user.id, email: user.email, username: user.username, roles, permissions: new Set(permissions) };
    next();
  } catch (err) {
    next(err);
  }
}

/** Exige TODOS los permisos indicados (usar tras `authenticate`). */
export function authorize(...required) {
  return (req, _res, next) => {
    if (!req.user) return next(new AuthError());
    if (!hasAll(req.user.permissions, required)) {
      const missing = required.filter((p) => !req.user.permissions.has(p));
      return next(new ForbiddenError(`Faltan permisos: ${missing.join(', ')}`, { code: 'FORBIDDEN' }));
    }
    next();
  };
}
