// Lecturas en vivo de una instancia del catálogo contra el Cloud SQL Admin API
// (como la consola de GCP): BDs y usuarios. Usan la service account de Ajustes,
// sin credenciales SQL.
import * as csql from '../gcp/cloudsql.client.js';
import { getInstance } from './catalog.service.js';
import { isSystemDatabase, supportsImportUser } from '../domain/restoreMapping.js';

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
