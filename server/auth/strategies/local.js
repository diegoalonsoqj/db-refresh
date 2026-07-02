// Estrategia de autenticación local: verifica password con argon2 contra
// app_users.password_hash. No revela si el fallo fue por usuario o password.
import argon2 from 'argon2';
import { getUserByEmailForAuth } from '../../data/repositories/users.repo.js';
import { AuthError } from '../../domain/errors.js';

const INVALID = () => new AuthError('Credenciales inválidas', { code: 'INVALID_CREDENTIALS' });

/**
 * Verifica email + password. Devuelve el usuario público (sin hash) o lanza AuthError.
 */
export async function verifyLocal(email, password) {
  const user = await getUserByEmailForAuth(email);
  // Verificar el hash aunque el usuario no exista mitiga timing/enumeración.
  const hash = user?.password_hash;
  const ok = hash ? await argon2.verify(hash, password).catch(() => false) : false;

  if (!user || user.auth_source !== 'local' || !user.is_active || !ok) {
    throw INVALID();
  }

  const { password_hash, ad_dn, ...publicUser } = user;
  return publicUser;
}

/** Genera un hash argon2id para almacenar (usado por el seed y la gestión de usuarios). */
export function hashPassword(password) {
  return argon2.hash(password, { type: argon2.argon2id });
}
