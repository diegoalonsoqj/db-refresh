// Reglas del mapping de un restore (backup -> BD destino [-> owner]). Funciones
// puras compartidas por el lanzamiento manual y las restauraciones programadas.
import { ValidationError } from './errors.js';

// Nombres seguros para archivos de backup y nombres de BD (evita inyección/paths).
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
// Usuarios de Cloud SQL: incluye '@' para usuarios IAM (p.ej. sa@proyecto.iam).
const SAFE_USER = /^[A-Za-z0-9._@-]+$/;

// BDs de sistema por motor: nunca se listan como destino ni se permite restaurar sobre ellas.
export const SYSTEM_DATABASES = {
  sqlserver: ['master', 'model', 'msdb', 'tempdb'],
  postgres: ['postgres', 'cloudsqladmin', 'template0', 'template1'],
  mysql: ['mysql', 'information_schema', 'performance_schema', 'sys'],
};

export function isSystemDatabase(engine, name) {
  return (SYSTEM_DATABASES[engine] ?? []).includes(String(name).toLowerCase());
}

/** Motores en los que el import admite elegir el usuario (owner de lo importado). */
export const supportsImportUser = (engine) => engine === 'postgres';

/**
 * Valida y normaliza el mapping [{ backupFile, targetDb, importUser? }].
 * @returns [{ backupFile, targetDb, importUser|null }]
 */
export function validateMapping(engine, mapping) {
  if (!Array.isArray(mapping) || mapping.length === 0) {
    throw new ValidationError('mapping vacío: indica al menos un backup -> BD');
  }
  const seen = new Set();
  return mapping.map((m) => {
    const backupFile = String(m?.backupFile ?? '').trim();
    const targetDb = String(m?.targetDb ?? '').trim();
    if (!SAFE_NAME.test(backupFile)) throw new ValidationError(`Nombre de backup inválido: ${backupFile}`);
    if (!SAFE_NAME.test(targetDb)) throw new ValidationError(`Nombre de BD inválido: ${targetDb}`);
    if (isSystemDatabase(engine, targetDb)) {
      throw new ValidationError(`${targetDb} es una BD de sistema de ${engine}: no se puede restaurar sobre ella`);
    }
    const key = targetDb.toLowerCase();
    if (seen.has(key)) throw new ValidationError(`BD destino repetida en el mapping: ${targetDb}`);
    seen.add(key);

    const importUser = String(m?.importUser ?? '').trim() || null;
    if (importUser) {
      if (!supportsImportUser(engine)) {
        throw new ValidationError(`El owner (importUser) solo se puede indicar en PostgreSQL, no en ${engine}`);
      }
      if (!SAFE_USER.test(importUser)) throw new ValidationError(`Usuario owner inválido: ${importUser}`);
    }
    return { backupFile, targetDb, importUser };
  });
}
