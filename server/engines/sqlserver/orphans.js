// Corrección de usuarios huérfanos tras restaurar un .bak en SQL Server
// (basado en docs/corregir_usuarios_huerfanos.sql). Se ejecuta en la BD recién
// restaurada con la conexión SQL de la instancia:
//  - Usuario de BD cuyo SID no existe en el servidor y hay un login con su mismo
//    nombre -> ALTER USER ... WITH LOGIN = ... (remapeo).
//  - Sin login con ese nombre -> se omite y se reporta (no se crean logins).
//  - Owner de la BD huérfano -> ALTER AUTHORIZATION al login indicado (opcional).
// Cada acción es independiente: un error no detiene el resto (se devuelve como aviso).
// Los nombres viajan como parámetros y se citan en el servidor con QUOTENAME.
import { runQuery } from './mssql.client.js';

// Usuarios SQL/Windows ligados a login de instancia (excluye contained, WITHOUT LOGIN,
// dbo/guest/INFORMATION_SCHEMA/sys y los internos ##...##) cuyo SID no existe en el servidor.
export const DETECT_ORPHANS_SQL = `
SELECT dp.name, dp.type
  FROM sys.database_principals dp
  LEFT JOIN sys.server_principals sp ON sp.sid = dp.sid
 WHERE dp.type IN ('S','U','G')
   AND dp.authentication_type IN (1,3)
   AND dp.principal_id > 4
   AND dp.name NOT LIKE '##%'
   AND sp.sid IS NULL
 ORDER BY dp.name;`;

const LOGIN_EXISTS_SQL = 'SELECT 1 AS found FROM sys.server_principals WHERE name = @name;';
const REMAP_SQL = `
DECLARE @cmd nvarchar(max) = N'ALTER USER ' + QUOTENAME(@name) + N' WITH LOGIN = ' + QUOTENAME(@name) + N';';
EXEC (@cmd);`;
const DB_OWNER_SQL = 'SELECT SUSER_SNAME(owner_sid) AS owner FROM sys.databases WHERE name = @db;';
const SET_OWNER_SQL = `
DECLARE @cmd nvarchar(max) = N'ALTER AUTHORIZATION ON DATABASE::' + QUOTENAME(@db) + N' TO ' + QUOTENAME(@owner) + N';';
EXEC (@cmd);`;

const ACCESS_SQL = `
SELECT HAS_DBACCESS(@db) AS has_access, SUSER_SNAME() AS me, SUSER_SNAME(owner_sid) AS owner
  FROM sys.databases WHERE name = @db;`;

/**
 * Paso previo (conectado a master): tras restaurar un .bak de otro entorno, el
 * login de la credencial no suele tener usuario en la BD y no puede ni abrirla.
 * Si no tiene acceso, toma el ownership (ALTER AUTHORIZATION a sí mismo) para
 * quedar como dbo. Requiere un login con privilegios de administración de Cloud
 * SQL (rol CustomerDbRootRole, como el usuario `sqlserver`).
 * @returns { took: boolean, login }
 */
export async function ensureDbAccess(masterPool, database) {
  const [row] = await runQuery(masterPool, ACCESS_SQL, { db: database });
  if (!row) throw new Error(`La BD ${database} no existe o no es visible para el login de la credencial`);
  if (row.has_access === 1) return { took: false, login: row.me };
  try {
    await runQuery(masterPool, SET_OWNER_SQL, { db: database, owner: row.me });
  } catch (err) {
    throw new Error(
      `el login ${row.me} no tiene acceso a ${database} y no puede tomar su ownership (${err.message}). ` +
        'Usa una credencial con el rol de administración de Cloud SQL (como el usuario sqlserver).',
    );
  }
  return { took: true, login: row.me };
}

/**
 * @param pool    conexión mssql abierta en la BD restaurada
 * @param options { database, dbOwner|null, forceOwner }
 *                forceOwner: asignar dbOwner aunque el owner no esté huérfano
 *                (p.ej. la app tomó el ownership para poder corregir).
 * @returns { orphans, remapped: [], skipped: [], errors: [{ user, message }], owner: { status, detail } }
 */
export async function fixOrphanUsers(pool, { database, dbOwner = null, forceOwner = false }) {
  const result = { orphans: 0, remapped: [], skipped: [], errors: [], owner: { status: 'ok', detail: null } };

  const orphans = await runQuery(pool, DETECT_ORPHANS_SQL);
  result.orphans = orphans.length;
  for (const { name } of orphans) {
    try {
      const login = await runQuery(pool, LOGIN_EXISTS_SQL, { name });
      if (!login.length) {
        result.skipped.push(name);
        continue;
      }
      await runQuery(pool, REMAP_SQL, { name });
      result.remapped.push(name);
    } catch (err) {
      result.errors.push({ user: name, message: err.message });
    }
  }

  try {
    const [row] = await runQuery(pool, DB_OWNER_SQL, { db: database });
    if (row && dbOwner && forceOwner && row.owner !== dbOwner) {
      await runQuery(pool, SET_OWNER_SQL, { db: database, owner: dbOwner });
      result.owner = { status: 'fixed', detail: dbOwner };
    } else if (row && row.owner === null) {
      if (!dbOwner) {
        result.owner = { status: 'skipped', detail: 'el owner de la BD está huérfano y no se indicó un login' };
      } else {
        await runQuery(pool, SET_OWNER_SQL, { db: database, owner: dbOwner });
        result.owner = { status: 'fixed', detail: dbOwner };
      }
    }
  } catch (err) {
    result.owner = { status: 'error', detail: err.message };
  }
  return result;
}

/** Líneas de log (nivel + texto) a partir del resultado (función pura). */
export function describeOrphanResult(database, r) {
  const lines = [];
  if (!r.orphans) lines.push(['info', `Usuarios huérfanos en ${database}: ninguno.`]);
  else {
    lines.push(['info', `Usuarios huérfanos en ${database}: ${r.orphans} detectado(s), ${r.remapped.length} remapeado(s), ` +
      `${r.skipped.length} sin login, ${r.errors.length} con error.`]);
    if (r.remapped.length) lines.push(['info', `Remapeados a su login: ${r.remapped.join(', ')}.`]);
    if (r.skipped.length) lines.push(['warning', `Sin login con el mismo nombre en la instancia (omitidos): ${r.skipped.join(', ')}.`]);
    for (const e of r.errors) lines.push(['warning', `No se pudo remapear ${e.user}: ${e.message}`]);
  }
  if (r.owner.status === 'fixed') lines.push(['info', `Owner de ${database} asignado a ${r.owner.detail}.`]);
  if (r.owner.status === 'skipped') lines.push(['warning', `Owner de ${database}: ${r.owner.detail}.`]);
  if (r.owner.status === 'error') lines.push(['warning', `No se pudo corregir el owner de ${database}: ${r.owner.detail}`]);
  return lines;
}
