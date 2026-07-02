// Validaciones de entrada reutilizables (nombres de archivo/BD, campos requeridos).
import { ValidationError } from '../domain/errors.js';

// Nombres seguros para archivos de backup y nombres de BD (evita inyección/paths).
export const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

/** Exige un string no vacío. Devuelve el valor recortado. */
export function assertNonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${label} es obligatorio`);
  }
  return value.trim();
}

/** Exige que el valor cumpla SAFE_NAME. */
export function assertSafeName(value, label) {
  if (typeof value !== 'string' || !SAFE_NAME.test(value)) {
    throw new ValidationError(`${label} inválido: ${value}`);
  }
  return value;
}

/** Exige que el valor esté dentro de `allowed`. */
export function assertOneOf(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new ValidationError(`${label} inválido: ${value}. Permitidos: ${allowed.join(', ')}`);
  }
  return value;
}
