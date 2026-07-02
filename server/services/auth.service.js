// Servicio de autenticación: valida credenciales según la fuente y emite el JWT.
// El controlador se encarga de poner/quitar la cookie httpOnly.
import { verifyLocal } from '../auth/strategies/local.js';
import { verifyAd } from '../auth/strategies/ad.js';
import { signToken } from '../auth/jwt.js';
import { touchLastLogin, getUserById } from '../data/repositories/users.repo.js';
import { getAdCredentials } from './settings.service.js';
import { ValidationError } from '../domain/errors.js';
import { logger } from '../lib/logger.js';

/** Métodos de login disponibles (público, para que el login muestre AD o no). */
export async function getAuthMethods() {
  let adConfigured = false;
  try {
    adConfigured = Boolean((await getAdCredentials())?.url);
  } catch {
    adConfigured = false;
  }
  return { local: true, ad: adConfigured };
}

/**
 * Login. `source` = 'local' (default) | 'ad'. Devuelve { user, token }.
 * `user` es público (sin hash). Lanza AuthError si las credenciales fallan.
 */
export async function login({ email, password, source = 'local' }) {
  if (!email || !password) {
    throw new ValidationError('email y password son obligatorios');
  }

  const user = source === 'ad'
    ? await verifyAd(email, password)
    : await verifyLocal(email, password);

  await touchLastLogin(user.id);
  const token = signToken({ sub: user.id, email: user.email, role: user.role });
  logger.info({ userId: user.id, source }, 'Login correcto');
  return { user, token };
}

/** Usuario público actual a partir del id del token (revalida contra la BD). */
export async function getCurrentUser(userId) {
  const user = await getUserById(userId);
  if (!user || !user.is_active) return null;
  return user;
}
