// Traduce errores de PostgreSQL a errores de dominio del app.
import { ConflictError } from '../domain/errors.js';

/**
 * Convierte violaciones conocidas de integridad en ConflictError (409):
 *  - 23505 unique_violation        -> ya existe
 *  - 23503 foreign_key_violation   -> en uso, no se puede eliminar
 * Cualquier otro error se re-lanza tal cual.
 */
export function mapPgError(err, { entity = 'Registro' } = {}) {
  if (err?.code === '23505') {
    return new ConflictError(`${entity} ya existe (valor duplicado)`, { code: 'DUPLICATE' });
  }
  if (err?.code === '23503') {
    return new ConflictError(`${entity} en uso: hay registros que dependen de él`, { code: 'IN_USE' });
  }
  return err;
}
