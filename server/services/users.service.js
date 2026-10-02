// Servicio de gestión de usuarios (admin) + cambio de password propio.
// Usuarios locales (password argon2) y de AD (pre-provisionados por un admin con
// su cuenta de red; la contraseña la valida el directorio).
import argon2 from 'argon2';
import * as repo from '../data/repositories/users.repo.js';
import { hashPassword } from '../auth/strategies/local.js';
import { mapPgError } from '../data/pgErrors.js';
import { NotFoundError, ValidationError, AuthError } from '../domain/errors.js';
import { assertNonEmpty, assertOneOf } from '../lib/validation.js';
import { AD_USERNAME_RE, normalizeAdUsername } from '../auth/ldap.js';

const ROLES = ['admin', 'operator', 'viewer'];
const MIN_PASSWORD = 10;

function assertPassword(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) {
    throw new ValidationError(`El password debe tener al menos ${MIN_PASSWORD} caracteres`);
  }
  return pw;
}

export const listUsers = () => repo.listUsers();

const SOURCES = ['local', 'ad'];

function optionalEmail(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return null;
  if (!/^[^@\s]+@[^@\s]+$/.test(v)) throw new ValidationError(`email inválido: ${v}`);
  return v;
}

export async function createUser(input) {
  const authSource = assertOneOf(input.authSource ?? 'local', SOURCES, 'authSource');
  const role = assertOneOf(input.role ?? 'viewer', ROLES, 'role');
  const fullName = typeof input.fullName === 'string' && input.fullName.trim() ? input.fullName.trim() : null;
  try {
    if (authSource === 'ad') {
      if (input.password) throw new ValidationError('Los usuarios de AD no usan password local');
      // Se guarda la cuenta sin dominio ("EMPRESA\jperez" -> "jperez"): el dominio
      // lo pone la configuración de AD al autenticar.
      const username = normalizeAdUsername(assertNonEmpty(input.username, 'username'));
      if (!AD_USERNAME_RE.test(username)) {
        throw new ValidationError('Usuario de red inválido (solo letras, dígitos, punto, guion y guion bajo)');
      }
      return await repo.insertAdUser({ username, email: optionalEmail(input.email), fullName, role });
    }
    const email = assertNonEmpty(input.email, 'email');
    assertPassword(input.password);
    const passwordHash = await hashPassword(input.password);
    return await repo.insertLocalUser({ email, fullName, role, passwordHash });
  } catch (err) {
    throw mapPgError(err, { entity: 'Usuario' });
  }
}

export async function updateUser(id, input, actingUserId) {
  const user = await repo.getUserById(id);
  if (!user) throw new NotFoundError(`Usuario ${id} no encontrado`);

  const role = input.role !== undefined ? assertOneOf(input.role, ROLES, 'role') : undefined;
  const isActive = input.isActive !== undefined ? Boolean(input.isActive) : undefined;

  // Evita que un admin se quite a sí mismo el acceso (lockout).
  if (id === actingUserId) {
    if (isActive === false) throw new ValidationError('No puedes desactivar tu propia cuenta');
    if (role !== undefined && role !== 'admin') throw new ValidationError('No puedes quitarte tu propio rol admin');
  }

  return repo.updateUserFields(id, { role, isActive, fullName: input.fullName });
}

export async function resetPassword(id, newPassword) {
  const user = await repo.getUserById(id);
  if (!user) throw new NotFoundError(`Usuario ${id} no encontrado`);
  if (user.auth_source !== 'local') throw new ValidationError('El password solo aplica a usuarios locales');
  assertPassword(newPassword);
  await repo.setPasswordHash(id, await hashPassword(newPassword));
}

export async function deleteUser(id, actingUserId) {
  if (id === actingUserId) throw new ValidationError('No puedes eliminar tu propia cuenta');
  const user = await repo.getUserById(id);
  if (!user) throw new NotFoundError(`Usuario ${id} no encontrado`);
  await repo.deleteUser(id);
}

/** Cambio de password del propio usuario autenticado (verifica el actual). */
export async function changeOwnPassword(userId, currentPassword, newPassword) {
  const current = await repo.getUserById(userId);
  if (!current) throw new NotFoundError('Usuario no encontrado');
  if (current.auth_source !== 'local') throw new ValidationError('Los usuarios de AD cambian su password en el directorio');
  const user = await repo.getUserByEmailForAuth(current.email);
  const ok = user.password_hash && (await argon2.verify(user.password_hash, currentPassword).catch(() => false));
  if (!ok) throw new AuthError('El password actual no es correcto', { code: 'BAD_CURRENT_PASSWORD' });
  assertPassword(newPassword);
  await repo.setPasswordHash(user.id, await hashPassword(newPassword));
}
