// Servicio de gestión de usuarios (admin) + cambio de password propio.
// Solo gestiona usuarios locales para password; los AD se administran en el directorio.
import argon2 from 'argon2';
import * as repo from '../data/repositories/users.repo.js';
import { hashPassword } from '../auth/strategies/local.js';
import { mapPgError } from '../data/pgErrors.js';
import { NotFoundError, ValidationError, AuthError } from '../domain/errors.js';
import { assertNonEmpty, assertOneOf } from '../lib/validation.js';

const ROLES = ['admin', 'operator', 'viewer'];
const MIN_PASSWORD = 10;

function assertPassword(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) {
    throw new ValidationError(`El password debe tener al menos ${MIN_PASSWORD} caracteres`);
  }
  return pw;
}

export const listUsers = () => repo.listUsers();

export async function createUser(input) {
  const email = assertNonEmpty(input.email, 'email');
  const role = assertOneOf(input.role ?? 'viewer', ROLES, 'role');
  assertPassword(input.password);
  const passwordHash = await hashPassword(input.password);
  try {
    return await repo.insertLocalUser({ email, fullName: input.fullName, role, passwordHash });
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
  const user = await repo.getUserByEmailForAuth((await repo.getUserById(userId))?.email ?? '');
  if (!user) throw new NotFoundError('Usuario no encontrado');
  if (user.auth_source !== 'local') throw new ValidationError('Los usuarios de AD cambian su password en el directorio');
  const ok = user.password_hash && (await argon2.verify(user.password_hash, currentPassword).catch(() => false));
  if (!ok) throw new AuthError('El password actual no es correcto', { code: 'BAD_CURRENT_PASSWORD' });
  assertPassword(newPassword);
  await repo.setPasswordHash(user.id, await hashPassword(newPassword));
}
