// Servicio de autenticación: valida credenciales según el tipo de usuario y
// emite el JWT. El controlador se encarga de poner/quitar la cookie httpOnly.
//
// Login único (como db-keeper): el usuario escribe su email (local) o su cuenta
// de red (AD: "jperez", "DOMINIO\jperez" o "jperez@empresa.com"); el tipo lo
// decide el usuario guardado, no el cliente.
import { verifyLocal } from '../auth/strategies/local.js';
import { verifyAd } from '../auth/strategies/ad.js';
import { normalizeAdUsername } from '../auth/ldap.js';
import { signToken } from '../auth/jwt.js';
import {
  touchLastLogin,
  getUserById,
  getUserByEmailForAuth,
  getAdUserByUsername,
  getAvatar,
} from '../data/repositories/users.repo.js';
import { getAdRuntimeConfig } from './settings.service.js';
import { getUserAccess } from '../data/repositories/rbac.repo.js';
import { AuthError, ValidationError } from '../domain/errors.js';
import { logger } from '../lib/logger.js';

const INVALID = (code = 'INVALID_CREDENTIALS') => new AuthError('Credenciales inválidas', { code });

/** Métodos de login disponibles (público, para que el login muestre la ayuda de AD). */
export async function getAuthMethods() {
  let ad = false;
  try {
    ad = Boolean(await getAdRuntimeConfig());
  } catch {
    ad = false;
  }
  return { local: true, ad };
}

/** Resuelve a qué usuario se refiere lo que se escribió en el login. */
async function findLoginUser(identifier) {
  if (identifier.includes('@')) {
    const byEmail = await getUserByEmailForAuth(identifier);
    if (byEmail) return byEmail;
  }
  // Cuenta de AD: se quita el dominio ("DOMINIO\x", "x@dominio" -> "x").
  return getAdUserByUsername(normalizeAdUsername(identifier));
}

/**
 * Login. `username` (o `email`, por compatibilidad) + `password`.
 * Devuelve { user, token }; `user` es público (sin hash). Lanza AuthError.
 */
export async function login({ username, email, password }) {
  const identifier = String(username ?? email ?? '').trim();
  if (!identifier || !password) {
    throw new ValidationError('usuario y password son obligatorios');
  }

  const found = await findLoginUser(identifier);
  let user;
  if (found?.auth_source === 'ad') {
    if (!found.is_active) throw INVALID('USER_INACTIVE');
    user = await verifyAd(found, password);
  } else {
    // Local (o inexistente: verifyLocal responde el mismo 401 genérico).
    user = await verifyLocal(found?.email ?? identifier, password);
  }

  await touchLastLogin(user.id);
  // El token solo identifica al usuario: roles y permisos se leen de la BD en cada petición.
  const token = signToken({ sub: user.id, email: user.email ?? user.username });
  logger.info({ userId: user.id, source: user.auth_source }, 'Login correcto');
  return { user: await withAccess(user), token };
}

/** Usuario público + foto + sus roles y permisos efectivos (RBAC): la UI decide con `has(permiso)`. */
async function withAccess(user) {
  const [{ roles, permissions }, avatar] = await Promise.all([getUserAccess(user.id), getAvatar(user.id)]);
  return { ...user, avatar, roles, permissions: [...permissions].sort() };
}

/** Usuario público actual a partir del id del token (revalida contra la BD). */
export async function getCurrentUser(userId) {
  const user = await getUserById(userId);
  if (!user || !user.is_active) return null;
  return withAccess(user);
}
