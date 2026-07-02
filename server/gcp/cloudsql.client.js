// Cliente Cloud SQL Admin API. Reemplaza los subprocess a `gcloud sql ...`.
// - import()          -> instances.import   (equiv. `gcloud sql import bak/sql`)
// - deleteDatabase()  -> databases.delete    (equiv. DROP DATABASE)
// - getOperation()    -> operations.get       (equiv. `gcloud sql operations describe`)
// - listOperations()  -> operations.list      (equiv. `gcloud sql operations list`)
import { sqladmin } from '@googleapis/sqladmin';
import { GoogleAuth } from 'google-auth-library';
import { InfraError } from '../domain/errors.js';
import { getSaCredentials } from '../services/settings.service.js';
import { currentEpoch } from './state.js';

// Cliente construido bajo demanda: usa la SA guardada en settings (cifrada en la
// BD) o, si no hay, ADC (GOOGLE_APPLICATION_CREDENTIALS / Workload Identity).
// Se cachea y se reconstruye cuando cambia el epoch (al guardar una nueva SA).
let cache = { epoch: -1, client: null };

async function getClient() {
  const epoch = currentEpoch();
  if (cache.client && cache.epoch === epoch) return cache.client;
  const sa = await getSaCredentials();
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    ...(sa ? { credentials: sa.credentials } : {}),
  });
  const client = sqladmin({ version: 'v1', auth });
  cache = { epoch, client };
  return client;
}

/**
 * Lanza un import asíncrono. Devuelve el nombre de la operación para hacer polling.
 * @param {object} p { project, instance, database, uri, fileType } fileType: 'BAK'|'SQL'
 * @returns operationName (string)
 */
export async function importBackup({ project, instance, database, uri, fileType }) {
  try {
    const client = await getClient();
    const { data } = await client.instances.import({
      project,
      instance,
      requestBody: {
        importContext: {
          kind: 'sql#importContext',
          fileType,          // 'BAK' (SQL Server) | 'SQL' (postgres/mysql, incl. .gz)
          uri,               // gs://bucket/archivo
          database,
        },
      },
    });
    if (!data.name) {
      throw new InfraError('import no devolvió operación', { code: 'NO_OPERATION' });
    }
    return data.name;
  } catch (err) {
    if (err instanceof InfraError) throw err;
    throw new InfraError(`Fallo al lanzar import de ${database}`, { code: 'IMPORT_FAILED', cause: err });
  }
}

/** Elimina una base de datos de la instancia (drop destructivo previo al restore). */
export async function deleteDatabase({ project, instance, database }) {
  try {
    const client = await getClient();
    const { data } = await client.databases.delete({ project, instance, database });
    return data.name; // operación async
  } catch (err) {
    // 404 => la BD no existía; el llamador decide si es error
    const status = err?.response?.status;
    if (status === 404) return null;
    throw new InfraError(`Fallo al eliminar la BD ${database}`, { code: 'DROP_FAILED', cause: err });
  }
}

/**
 * Crea una BD vacía en la instancia (databases.insert). Necesario para motores
 * que importan dumps SQL (PostgreSQL/MySQL): el import escribe en una BD que
 * debe existir, así que tras el DROP destructivo hay que recrearla vacía.
 * @returns operationName (string)
 */
export async function createDatabase({ project, instance, database }) {
  try {
    const client = await getClient();
    const { data } = await client.databases.insert({
      project,
      instance,
      requestBody: { name: database },
    });
    if (!data.name) {
      throw new InfraError('databases.insert no devolvió operación', { code: 'NO_OPERATION' });
    }
    return data.name;
  } catch (err) {
    if (err instanceof InfraError) throw err;
    throw new InfraError(`Fallo al crear la BD ${database}`, { code: 'CREATE_DB_FAILED', cause: err });
  }
}

/** Estado de una operación async. Devuelve { status, error }. status: PENDING|RUNNING|DONE */
export async function getOperation({ project, operation }) {
  try {
    const client = await getClient();
    const { data } = await client.operations.get({ project, operation });
    return { status: data.status, error: data.error ?? null, raw: data };
  } catch (err) {
    throw new InfraError(`Fallo al consultar operación ${operation}`, { code: 'OP_GET_FAILED', cause: err });
  }
}

/** Lista operaciones de una instancia (para validar que no haya nada en curso). */
export async function listOperations({ project, instance }) {
  try {
    const client = await getClient();
    const { data } = await client.operations.list({ project, instance });
    return data.items ?? [];
  } catch (err) {
    throw new InfraError(`Fallo al listar operaciones de ${instance}`, { code: 'OP_LIST_FAILED', cause: err });
  }
}

/**
 * Hace polling de una operación hasta DONE / error / timeout.
 * @returns { ok: boolean, error?: object }
 */
export async function waitForOperation(
  { project, operation },
  { timeoutSeconds, pollIntervalSeconds, onPoll } = {},
) {
  const deadline = Date.now() + (timeoutSeconds ?? 10_800) * 1000;
  const intervalMs = (pollIntervalSeconds ?? 30) * 1000;

  while (Date.now() < deadline) {
    const { status, error } = await getOperation({ project, operation });
    if (onPoll) await onPoll(status);

    if (status === 'DONE') {
      if (error) return { ok: false, error };
      return { ok: true };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { ok: false, error: { code: 'TIMEOUT', message: `Timeout esperando ${operation}` } };
}
