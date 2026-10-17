// Servicio de gestión de usuarios (admin) + cambio de password propio.
// Usuarios locales (password argon2) y de AD (pre-provisionados por un admin con
// su cuenta de red; la contraseña la valida el directorio).
import argon2 from 'argon2';
import * as repo from '../data/repositories/users.repo.js';
import * as rbac from '../data/repositories/rbac.repo.js';
import { hashPassword } from '../auth/strategies/local.js';
import { mapPgError } from '../data/pgErrors.js';
import { AuthError, ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.js';
import { assertNonEmpty, assertOneOf } from '../lib/validation.js';
import { parseListQuery } from '../lib/listQuery.js';
import { AD_USERNAME_RE, normalizeAdUsername } from '../auth/ldap.js';
import { SUPERADMIN, uniqueKeys, unknownKeys } from '../domain/permissions.js';

const MIN_PASSWORD = 10;
const MAX_AVATAR_CHARS = 200_000; // ~150 KB de imagen; el navegador la reduce a 96 px
const AVATAR_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

/**
 * Roles pedidos: `roles` (lista de claves, RBAC) o `role` (una clave, compatibilidad
 * con la UI anterior). Valida que existan. undefined = no se tocan.
 */
async function requestedRoles(input, { required = false } = {}) {
  let list;
  if (input.roles !== undefined) list = uniqueKeys(input.roles);
  else if (input.role !== undefined) list = uniqueKeys([input.role]);
  else return required ? ['viewer'] : undefined;
  if (!list.length) throw new ValidationError('Asigna al menos un rol al usuario');
  const known = (await rbac.roleIdsByKeys(list)).map((r) => r.key);
  const unknown = unknownKeys(list, known);
  if (unknown.length) throw new ValidationError(`Roles desconocidos: ${unknown.join(', ')}`);
  return list;
}

/** Evita dejar el sistema sin ningún superadmin activo. */
async function assertKeepsSuperadmin(user, { removesSuperadmin }) {
  if (!removesSuperadmin || !user.roles.includes(SUPERADMIN) || !user.is_active) return;
  if ((await rbac.countActiveSuperadmins(user.id)) === 0) {
    throw new ValidationError('Debe quedar al menos un superadmin activo');
  }
}

/**
 * Dar o quitar el rol superadmin equivale a gestionar roles: solo quien tiene
 * `roles:write` (superadmin). Así un admin no puede elevar a otra cuenta.
 */
function assertCanTouchSuperadmin(actor, before, after) {
  if (before.includes(SUPERADMIN) === after.includes(SUPERADMIN)) return;
  if (!actor?.permissions?.has('roles:write')) {
    throw new ForbiddenError('Solo quien gestiona roles puede asignar o quitar el rol superadmin');
  }
}

/** Nombre: undefined = no se toca; vacío = se quita. */
function optionalFullName(value) {
  if (value === undefined) return undefined;
  const v = typeof value === 'string' ? value.trim() : '';
  if (v.length > 200) throw new ValidationError('El nombre es demasiado largo (máx. 200)');
  return v || null;
}

function assertPassword(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) {
    throw new ValidationError(`El password debe tener al menos ${MIN_PASSWORD} caracteres`);
  }
  return pw;
}

/** Usuarios paginados con búsqueda, filtros (rol, tipo, estado) y orden. */
export const listUsers = (rawQuery) => repo.listUsers(parseListQuery(rawQuery, {
  sorts: repo.USER_SORTS,
  filters: { role: 'text', authSource: ['local', 'ad'], active: 'bool' },
}));

const SOURCES = ['local', 'ad'];

function optionalEmail(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return null;
  if (!/^[^@\s]+@[^@\s]+$/.test(v)) throw new ValidationError(`email inválido: ${v}`);
  return v;
}

/** Alta con roles; `isActive: false` permite crearlo ya desactivado. */
async function created(id, input) {
  if (input.isActive === false) return repo.updateUserFields(id, { isActive: false });
  return repo.getUserById(id);
}

export async function createUser(input, actor) {
  const authSource = assertOneOf(input.authSource ?? 'local', SOURCES, 'authSource');
  const roles = await requestedRoles(input, { required: true });
  assertCanTouchSuperadmin(actor, [], roles);
  const fullName = optionalFullName(input.fullName) ?? null;
  try {
    if (authSource === 'ad') {
      if (input.password) throw new ValidationError('Los usuarios de AD no usan password local');
      // Se guarda la cuenta sin dominio ("EMPRESA\jperez" -> "jperez"): el dominio
      // lo pone la configuración de AD al autenticar.
      const username = normalizeAdUsername(assertNonEmpty(input.username, 'username'));
      if (!AD_USERNAME_RE.test(username)) {
        throw new ValidationError('Usuario de red inválido (solo letras, dígitos, punto, guion y guion bajo)');
      }
      const id = await repo.insertAdUser({ username, email: optionalEmail(input.email), fullName });
      await rbac.setUserRoles(id, roles);
      return created(id, input);
    }
    const email = assertNonEmpty(input.email, 'email');
    assertPassword(input.password);
    const passwordHash = await hashPassword(input.password);
    const id = await repo.insertLocalUser({ email, fullName, passwordHash });
    await rbac.setUserRoles(id, roles);
    return created(id, input);
  } catch (err) {
    throw mapPgError(err, { entity: 'Usuario' });
  }
}

/**
 * Edición desde el modal de Usuarios: roles, estado, nombre, email y, para
 * usuarios locales, un password nuevo (opcional). El tipo y la cuenta de red no cambian.
 */
export async function updateUser(id, input, actor) {
  const user = await repo.getUserById(id);
  if (!user) throw new NotFoundError(`Usuario ${id} no encontrado`);

  const roles = await requestedRoles(input);
  const isActive = input.isActive !== undefined ? Boolean(input.isActive) : undefined;
  const fullName = optionalFullName(input.fullName);
  let email;
  if (input.email !== undefined) {
    email = optionalEmail(input.email);
    if (user.auth_source === 'local' && !email) throw new ValidationError('El email es obligatorio para usuarios locales');
  }
  const password = input.password ? input.password : undefined;
  if (password !== undefined) {
    if (user.auth_source !== 'local') throw new ValidationError('Los usuarios de AD no usan password local');
    assertPassword(password);
  }

  // Evita que un usuario se quite a sí mismo el acceso (lockout).
  if (id === actor?.id) {
    if (isActive === false) throw new ValidationError('No puedes desactivar tu propia cuenta');
    if (roles !== undefined && [...roles].sort().join() !== [...user.roles].sort().join()) {
      throw new ValidationError('No puedes cambiar tus propios roles: pídeselo a otro administrador');
    }
  }
  if (roles !== undefined) assertCanTouchSuperadmin(actor, user.roles, roles);
  await assertKeepsSuperadmin(user, {
    removesSuperadmin: isActive === false || (roles !== undefined && !roles.includes(SUPERADMIN)),
  });

  try {
    if (roles !== undefined) await rbac.setUserRoles(id, roles);
    if (password !== undefined) await repo.setPasswordHash(id, await hashPassword(password));
    return await repo.updateUserFields(id, { isActive, fullName, email });
  } catch (err) {
    throw mapPgError(err, { entity: 'Usuario' });
  }
}

export async function resetPassword(id, newPassword) {
  const user = await repo.getUserById(id);
  if (!user) throw new NotFoundError(`Usuario ${id} no encontrado`);
  if (user.auth_source !== 'local') throw new ValidationError('El password solo aplica a usuarios locales');
  assertPassword(newPassword);
  await repo.setPasswordHash(id, await hashPassword(newPassword));
}

export async function deleteUser(id, actor) {
  if (id === actor?.id) throw new ValidationError('No puedes eliminar tu propia cuenta');
  const user = await repo.getUserById(id);
  if (!user) throw new NotFoundError(`Usuario ${id} no encontrado`);
  assertCanTouchSuperadmin(actor, user.roles, []);
  await assertKeepsSuperadmin(user, { removesSuperadmin: true });
  await repo.deleteUser(id);
}

/**
 * Perfil propio (modal «Mi perfil», como db-keeper): nombre, email y foto.
 * undefined = no se toca; vacío/null = se quita (el email de un local es obligatorio).
 */
export async function updateOwnProfile(userId, input = {}) {
  const user = await repo.getUserById(userId);
  if (!user) throw new NotFoundError('Usuario no encontrado');
  const fullName = optionalFullName(input.fullName);
  let email;
  if (input.email !== undefined) {
    email = optionalEmail(input.email);
    if (user.auth_source === 'local' && !email) throw new ValidationError('El email es obligatorio para usuarios locales');
  }
  let avatar;
  if (input.avatar !== undefined) {
    avatar = input.avatar ? String(input.avatar) : null;
    if (avatar && (avatar.length > MAX_AVATAR_CHARS || !AVATAR_RE.test(avatar))) {
      throw new ValidationError('La foto debe ser una imagen PNG, JPEG o WebP pequeña');
    }
  }
  try {
    if (avatar !== undefined) await repo.setAvatar(userId, avatar);
    return await repo.updateUserFields(userId, { fullName, email });
  } catch (err) {
    throw mapPgError(err, { entity: 'Usuario' });
  }
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
