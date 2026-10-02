// Controladores de auth: login (setea cookie httpOnly), logout, me, cambio de password.
import * as authService from '../services/auth.service.js';
import * as usersService from '../services/users.service.js';
import { AUTH_COOKIE } from '../auth/middleware.js';
import { config } from '../config/index.js';
import { audit } from '../lib/audit.js';

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',           // mitiga CSRF en peticiones cross-site
    secure: config.env === 'production', // solo HTTPS en prod
    maxAge: config.auth.sessionMaxAgeMs,
    path: '/',
  };
}

export async function methods(_req, res, next) {
  try {
    res.json(await authService.getAuthMethods());
  } catch (err) {
    next(err);
  }
}

export async function login(req, res, next) {
  const { username, email, password } = req.body ?? {};
  const identifier = username ?? email;
  try {
    const { user, token } = await authService.login({ username, email, password });
    res.cookie(AUTH_COOKIE, token, cookieOptions());
    audit({ req, actor: user.id, action: 'auth.login', metadata: { source: user.auth_source } });
    res.json({ user });
  } catch (err) {
    // Auditar el intento fallido (sin password). El identificador no es secreto;
    // `reason` distingue p. ej. AD_UNAVAILABLE de INVALID_CREDENTIALS.
    audit({ req, actor: null, action: 'auth.login_failed', metadata: { identifier, reason: err.code } });
    next(err);
  }
}

export async function changePassword(req, res, next) {
  try {
    await usersService.changeOwnPassword(req.user.id, req.body?.currentPassword, req.body?.newPassword);
    audit({ req, action: 'auth.change_password' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export function logout(_req, res) {
  res.clearCookie(AUTH_COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
}

export async function me(req, res, next) {
  try {
    const user = await authService.getCurrentUser(req.user.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ user });
  } catch (err) {
    next(err);
  }
}
