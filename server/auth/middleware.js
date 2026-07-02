// Middleware de autenticación (JWT en cookie httpOnly) y autorización (RBAC).
import { verifyToken } from './jwt.js';
import { AuthError, ForbiddenError } from '../domain/errors.js';

export const AUTH_COOKIE = 'session';

/** Extrae el token de la cookie httpOnly (o del header Bearer como alternativa). */
function extractToken(req) {
  const fromCookie = req.cookies?.[AUTH_COOKIE];
  if (fromCookie) return fromCookie;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

/** Exige sesión válida. Puebla req.user = { id, email, role }. */
export function authenticate(req, _res, next) {
  try {
    const token = extractToken(req);
    if (!token) throw new AuthError('Sesión requerida', { code: 'NO_SESSION' });
    const payload = verifyToken(token);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    next();
  } catch (err) {
    next(err);
  }
}

/** Exige que el usuario autenticado tenga uno de los roles indicados. */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new AuthError());
    if (!roles.includes(req.user.role)) {
      return next(new ForbiddenError(`Requiere rol: ${roles.join(' | ')}`));
    }
    next();
  };
}
