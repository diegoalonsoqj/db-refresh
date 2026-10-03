// Lecturas en vivo de una instancia del catálogo contra el Cloud SQL Admin API
// (como la consola de GCP): BDs y usuarios. Usan la service account de Ajustes,
// sin credenciales SQL.
import * as csql from '../gcp/cloudsql.client.js';
import { getInstance } from './catalog.service.js';
import { isSystemDatabase, supportsImportUser } from '../domain/restoreMapping.js';
import { missingSqlCredentials } from '../domain/instance.js';
import { resolveSqlConnection } from '../engines/sql/connection.js';
import { runQuery, withConnection } from '../engines/sqlserver/mssql.client.js';

/** Estado de la instancia (encendida / detenida / mantenimiento) para avisar antes de lanzar. */
export async function getStatus(instanceId) {
  const instance = await getInstance(instanceId);
  return csql.getInstanceStatus({ project: instance.project_id, instance: instance.instance_name });
}

/** BDs de usuario de la instancia (sin las de sistema), ordenadas por nombre. */
export async function listDatabases(instanceId) {
  const instance = await getInstance(instanceId);
  const dbs = await csql.listDatabases({ project: instance.project_id, instance: instance.instance_name });
  return dbs
    .filter((d) => !isSystemDatabase(instance.engine, d.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Usuarios de la instancia candidatos a owner del import. Solo PostgreSQL admite
 * elegirlo (importUser); en el resto devuelve `supported: false` y lista vacía.
 */
export async function listUsers(instanceId) {
  const instance = await getInstance(instanceId);
  if (!supportsImportUser(instance.engine)) return { supported: false, users: [] };
  const users = await csql.listUsers({ project: instance.project_id, instance: instance.instance_name });
  return {
    supported: true,
    users: users.filter((u) => u.name).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Logins de SQL Server de la instancia (para elegir el owner de la BD al corregir
 * usuarios huérfanos). Se leen por la conexión SQL (IP privada + credencial).
 * -> { supported, logins: [{ name, type }], reason? }
 */
export async function listLogins(instanceId) {
  const instance = await getInstance(instanceId);
  if (instance.engine !== 'sqlserver') return { supported: false, logins: [] };
  if (missingSqlCredentials(instance).length) {
    return { supported: true, logins: [], reason: 'La instancia no tiene conexión SQL (IP privada + credencial)' };
  }
  const conn = await resolveSqlConnection(instance);
  const rows = await withConnection(conn, null, (pool) => runQuery(pool, `
    SELECT name, type_desc AS type FROM sys.server_principals
     WHERE type IN ('S','U','G') AND is_disabled = 0 AND name NOT LIKE '##%' AND name NOT LIKE 'NT %'
     ORDER BY name;`));
  return { supported: true, logins: rows };
}
