// RBAC granular (modelo de db-keeper): reglas puras. El catálogo de permisos vive
// en la BD (app_permissions, sembrado por db/schema.sql); aquí solo las reglas.
import { ValidationError } from './errors.js';

export const SUPERADMIN = 'superadmin';

// Clave de rol: minúsculas, dígitos y guion bajo, empezando por letra (como db-keeper).
const ROLE_KEY_RE = /^[a-z][a-z0-9_]{1,49}$/;

export function assertRoleKey(key) {
  const k = String(key ?? '').trim();
  if (!ROLE_KEY_RE.test(k)) {
    throw new ValidationError('Clave de rol inválida: usa minúsculas, números y guion bajo (2-50, empieza por letra)');
  }
  return k;
}

/** Normaliza una lista de claves (sin duplicados ni vacíos). */
export function uniqueKeys(list) {
  if (!Array.isArray(list)) throw new ValidationError('Se esperaba una lista de claves');
  return [...new Set(list.map((k) => String(k ?? '').trim()).filter(Boolean))];
}

/** Claves de `wanted` que no existen en `known` (para rechazarlas con un mensaje claro). */
export function unknownKeys(wanted, known) {
  const set = new Set(known);
  return wanted.filter((k) => !set.has(k));
}

/**
 * Rol «heredado» (admin | operator | viewer) derivado de los permisos, para la UI
 * anterior al RBAC mientras se migra a `has(permiso)`.
 */
export function legacyRole(permissions) {
  const p = new Set(permissions);
  if (p.has('users:write') || p.has('settings:write')) return 'admin';
  if (p.has('tasks:run') || p.has('tasks:write')) return 'operator';
  return 'viewer';
}

/** ¿Tiene todos los permisos pedidos? */
export function hasAll(granted, required) {
  const set = granted instanceof Set ? granted : new Set(granted);
  return required.every((r) => set.has(r));
}
