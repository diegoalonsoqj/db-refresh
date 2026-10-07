// Roles y permisos (RBAC, como db-keeper): CRUD de roles y su conjunto de permisos.
import * as repo from '../data/repositories/rbac.repo.js';
import { mapPgError } from '../data/pgErrors.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.js';
import { SUPERADMIN, assertRoleKey, uniqueKeys, unknownKeys } from '../domain/permissions.js';

export const listPermissions = () => repo.listPermissions();
export const listRoles = () => repo.listRoles();

async function getRole(id) {
  const role = await repo.getRoleById(id);
  if (!role) throw new NotFoundError('Rol no encontrado');
  return role;
}

/** Valida que todas las claves de permiso existan en el catálogo. */
async function validPermissions(list) {
  const keys = uniqueKeys(list ?? []);
  const unknown = unknownKeys(keys, (await repo.listPermissions()).map((p) => p.key));
  if (unknown.length) throw new ValidationError(`Permisos desconocidos: ${unknown.join(', ')}`);
  return keys;
}

function assertName(name) {
  const n = String(name ?? '').trim();
  if (!n || n.length > 100) throw new ValidationError('El nombre del rol es obligatorio (máx. 100)');
  return n;
}

function optionalDescription(d) {
  if (d === undefined) return undefined;
  const v = String(d ?? '').trim();
  if (v.length > 500) throw new ValidationError('La descripción es demasiado larga (máx. 500)');
  return v || null;
}

export async function createRole(input) {
  const key = assertRoleKey(input?.key);
  const name = assertName(input?.name);
  const description = optionalDescription(input?.description) ?? null;
  const permissions = await validPermissions(input?.permissions);
  if (await repo.getRoleByKey(key)) throw new ConflictError('Ya existe un rol con esa clave');
  try {
    const id = await repo.insertRole({ key, name, description });
    await repo.setRolePermissions(id, permissions);
    return getRole(id);
  } catch (err) {
    throw mapPgError(err, { entity: 'Rol' });
  }
}

export async function updateRole(id, input) {
  const role = await getRole(id);
  const name = input?.name !== undefined ? assertName(input.name) : undefined;
  const description = optionalDescription(input?.description);
  await repo.updateRoleMeta(id, { name, description });
  if (input?.permissions !== undefined) {
    // superadmin conserva siempre todos los permisos: así nunca se bloquea el sistema.
    if (role.key === SUPERADMIN) throw new ForbiddenError('No se pueden modificar los permisos del rol superadmin');
    await repo.setRolePermissions(id, await validPermissions(input.permissions));
  }
  return getRole(id);
}

export async function deleteRole(id) {
  const role = await getRole(id);
  if (role.is_system) throw new ForbiddenError('No se puede eliminar un rol de sistema');
  if (role.user_count > 0) {
    throw new ConflictError(`El rol está asignado a ${role.user_count} usuario(s): quítaselo antes de eliminarlo`);
  }
  await repo.deleteRole(id);
}
