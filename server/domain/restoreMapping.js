// Reglas del mapping de un restore (backup -> BD destino [-> owner] [-> esquema]).
// Funciones puras compartidas por el lanzamiento manual y las programadas.
import { ValidationError } from './errors.js';

// Nombres seguros para archivos de backup y nombres de BD (evita inyección/paths).
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
// Usuarios de Cloud SQL: incluye '@' para usuarios IAM (p.ej. sa@proyecto.iam).
const SAFE_USER = /^[A-Za-z0-9._@-]+$/;
// Login de SQL Server (incluye DOMINIO\usuario); se cita con QUOTENAME en el servidor.
const SAFE_LOGIN = /^[A-Za-z0-9._@\\-]{1,128}$/;
// Identificador de esquema PostgreSQL sin comillas (se cita siempre al usarlo).
const SAFE_SCHEMA = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;

// BDs de sistema por motor: nunca se listan como destino ni se permite restaurar sobre ellas.
export const SYSTEM_DATABASES = {
  sqlserver: ['master', 'model', 'msdb', 'tempdb'],
  postgres: ['postgres', 'cloudsqladmin', 'template0', 'template1'],
  mysql: ['mysql', 'information_schema', 'performance_schema', 'sys'],
};
const SYSTEM_SCHEMAS = ['pg_catalog', 'information_schema', 'pg_toast'];

export function isSystemDatabase(engine, name) {
  return (SYSTEM_DATABASES[engine] ?? []).includes(String(name).toLowerCase());
}

/** Motores en los que el import admite elegir el usuario (owner de lo importado). */
export const supportsImportUser = (engine) => engine === 'postgres';

// Métodos de restore: 'import' (Cloud SQL Admin API, todos los motores) |
// 'native' (pg_restore/psql desde el VPS, solo PostgreSQL).
export const METHODS = ['import', 'native'];
export const supportsNative = (engine) => engine === 'postgres';

/**
 * Formato de un dump para el restore nativo según su extensión:
 * 'tar' (pg_dump -Ft) -> pg_restore; 'plain' / 'plain-gz' (.sql / .sql.gz) -> psql.
 * null = no admitido.
 */
export function nativeDumpFormat(fileName) {
  const f = String(fileName).toLowerCase();
  if (f.endsWith('.tar')) return 'tar';
  if (f.endsWith('.sql')) return 'plain';
  if (f.endsWith('.sql.gz') || f.endsWith('.gz')) return 'plain-gz';
  return null;
}
export const NATIVE_EXTENSIONS = ['.tar', '.sql', '.gz'];

/**
 * Valida y normaliza el mapping [{ backupFile, targetDb, importUser?, scope?, schemaName? }].
 * @param engine  motor de la instancia
 * @param mapping filas del formulario / programada
 * @param method  'import' | 'native'
 * @returns [{ backupFile, targetDb, importUser|null, scope, schemaName|null }]
 */
export function validateMapping(engine, mapping, method = 'import') {
  if (!METHODS.includes(method)) throw new ValidationError(`Método de restore inválido: ${method}`);
  if (method === 'native' && !supportsNative(engine)) {
    throw new ValidationError(`El restore nativo (pg_restore/psql) solo está disponible para PostgreSQL, no para ${engine}`);
  }
  if (!Array.isArray(mapping) || mapping.length === 0) {
    throw new ValidationError('mapping vacío: indica al menos un backup -> BD');
  }
  const seen = new Set();
  const wholeDbs = new Set();
  const items = mapping.map((m) => {
    const backupFile = String(m?.backupFile ?? '').trim();
    const targetDb = String(m?.targetDb ?? '').trim();
    if (!SAFE_NAME.test(backupFile)) throw new ValidationError(`Nombre de backup inválido: ${backupFile}`);
    if (!SAFE_NAME.test(targetDb)) throw new ValidationError(`Nombre de BD inválido: ${targetDb}`);
    if (isSystemDatabase(engine, targetDb)) {
      throw new ValidationError(`${targetDb} es una BD de sistema de ${engine}: no se puede restaurar sobre ella`);
    }

    const scope = m?.scope ?? 'database';
    if (!['database', 'schema'].includes(scope)) throw new ValidationError(`Alcance inválido: ${scope}`);
    let schemaName = null;
    if (method === 'native') {
      if (!nativeDumpFormat(backupFile)) {
        throw new ValidationError(`Formato no admitido para el restore nativo: ${backupFile} (usa .tar, .sql o .sql.gz)`);
      }
      if (scope === 'schema') {
        schemaName = String(m?.schemaName ?? '').trim();
        if (!SAFE_SCHEMA.test(schemaName)) throw new ValidationError(`Nombre de esquema inválido: ${schemaName}`);
        if (SYSTEM_SCHEMAS.includes(schemaName.toLowerCase())) {
          throw new ValidationError(`${schemaName} es un esquema de sistema: no se puede restaurar`);
        }
      }
    } else if (scope !== 'database') {
      throw new ValidationError('Restaurar un solo esquema requiere el método nativo (pg_restore/psql)');
    }

    const db = targetDb.toLowerCase();
    const key = scope === 'schema' ? `${db}.${schemaName.toLowerCase()}` : db;
    if (seen.has(key)) {
      throw new ValidationError(`Destino repetido en el mapping: ${scope === 'schema' ? `${targetDb}.${schemaName}` : targetDb}`);
    }
    seen.add(key);
    if (scope === 'database') wholeDbs.add(db);

    const importUser = String(m?.importUser ?? '').trim() || null;
    if (importUser) {
      if (!supportsImportUser(engine)) {
        throw new ValidationError(`El owner (importUser) solo se puede indicar en PostgreSQL, no en ${engine}`);
      }
      if (!SAFE_USER.test(importUser)) throw new ValidationError(`Usuario owner inválido: ${importUser}`);
    }
    // Corrección de usuarios huérfanos tras restaurar: solo SQL Server.
    const fixOrphans = m?.fixOrphans === true;
    let dbOwner = null;
    if (fixOrphans) {
      if (engine !== 'sqlserver') {
        throw new ValidationError(`La corrección de usuarios huérfanos solo aplica a SQL Server, no a ${engine}`);
      }
      dbOwner = String(m?.dbOwner ?? '').trim() || null;
      if (dbOwner && !SAFE_LOGIN.test(dbOwner)) throw new ValidationError(`Login owner inválido: ${dbOwner}`);
    }
    return { backupFile, targetDb, importUser, scope, schemaName, fixOrphans, dbOwner };
  });

  // Restaurar la BD completa y además un esquema de esa misma BD en el mismo job es contradictorio.
  for (const it of items) {
    if (it.scope === 'schema' && wholeDbs.has(it.targetDb.toLowerCase())) {
      throw new ValidationError(`${it.targetDb} se restaura completa y también por esquema en el mismo job`);
    }
  }
  return items;
}
