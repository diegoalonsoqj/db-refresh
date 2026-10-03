// Cliente Cloud SQL Admin API. Reemplaza los subprocess a `gcloud sql ...`.
// - import()          -> instances.import   (equiv. `gcloud sql import bak/sql`)
// - deleteDatabase()  -> databases.delete    (equiv. DROP DATABASE)
// - getOperation()    -> operations.get       (equiv. `gcloud sql operations describe`)
// - listOperations()  -> operations.list      (equiv. `gcloud sql operations list`)
// - listDatabases()   -> databases.list       (equiv. `gcloud sql databases list`)
// - listUsers()       -> users.list           (equiv. `gcloud sql users list`)
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
 * importContext del Admin API (función pura). `importUser` solo aplica a
 * PostgreSQL: el import se ejecuta con ese usuario y los objetos quedan a su nombre.
 */
export function buildImportContext({ database, uri, fileType, importUser }) {
  return {
    kind: 'sql#importContext',
    fileType,          // 'BAK' (SQL Server) | 'SQL' (postgres/mysql, incl. .gz)
    uri,               // gs://bucket/archivo
    database,
    ...(importUser ? { importUser } : {}),
  };
}

/**
 * Lanza un import asíncrono. Devuelve el nombre de la operación para hacer polling.
 * @param {object} p { project, instance, database, uri, fileType, importUser? } fileType: 'BAK'|'SQL'
 * @returns operationName (string)
 */
export async function importBackup({ project, instance, database, uri, fileType, importUser }) {
  try {
    const client = await getClient();
    const { data } = await client.instances.import({
      project,
      instance,
      requestBody: { importContext: buildImportContext({ database, uri, fileType, importUser }) },
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

/**
 * Texto legible de un error de GCP (función pura): error de una operación
 * ({ errors: [{ code, message }] }), error HTTP de googleapis (Gaxios) u otro Error.
 */
export function describeGcpError(cause) {
  if (!cause) return '';
  const opErrors = cause.errors ?? cause.error?.errors;
  if (Array.isArray(opErrors) && opErrors.length) {
    return opErrors.map((e) => [e.code, e.message].filter(Boolean).join(': ')).join('; ');
  }
  const api = cause.response?.data?.error;
  if (api?.message) return `${cause.response.status ?? ''} ${api.message}`.trim();
  return cause.message ?? String(cause);
}

/**
 * ¿La instancia acepta operaciones? (función pura sobre instances.get).
 * Una instancia detenida desde la consola conserva state RUNNABLE pero con
 * activationPolicy NEVER; el resto de estados (SUSPENDED, MAINTENANCE, FAILED...)
 * tampoco admiten drop/import.
 * @returns { running, state, activationPolicy, reason|null }
 */
export function instanceRunState(data = {}) {
  const state = data.state ?? 'UNKNOWN';
  const activationPolicy = data.settings?.activationPolicy ?? null;
  let reason = null;
  if (activationPolicy === 'NEVER') reason = 'está detenida';
  else if (state !== 'RUNNABLE') reason = `no está disponible (estado ${state})`;
  return { running: !reason, state, activationPolicy, reason };
}

/** Estado de la instancia (instances.get). -> instanceRunState(...) + databaseVersion */
export async function getInstanceStatus({ project, instance }) {
  try {
    const client = await getClient();
    const { data } = await client.instances.get({ project, instance });
    return { ...instanceRunState(data), databaseVersion: data.databaseVersion ?? null };
  } catch (err) {
    throw new InfraError(`No se pudo consultar el estado de la instancia ${instance}`, {
      code: 'INSTANCE_GET_FAILED',
      cause: err,
    });
  }
}

/** ¿Existe la BD en la instancia? (databases.get; 404 -> false). */
export async function databaseExists({ project, instance, database }) {
  try {
    const client = await getClient();
    await client.databases.get({ project, instance, database });
    return true;
  } catch (err) {
    if (err?.response?.status === 404) return false;
    throw new InfraError(`No se pudo comprobar si existe la BD ${database}`, { code: 'DB_GET_FAILED', cause: err });
  }
}

/** BDs de la instancia (sin credenciales SQL: Admin API con la SA). -> [{ name, charset, collation }] */
export async function listDatabases({ project, instance }) {
  try {
    const client = await getClient();
    const { data } = await client.databases.list({ project, instance });
    return (data.items ?? []).map((d) => ({
      name: d.name,
      charset: d.charset ?? null,
      collation: d.collation ?? null,
    }));
  } catch (err) {
    throw new InfraError(`No se pudieron listar las BDs de ${instance}`, { code: 'DB_LIST_FAILED', cause: err });
  }
}

/** Usuarios de la instancia (Admin API). -> [{ name, type, host }] */
export async function listUsers({ project, instance }) {
  try {
    const client = await getClient();
    const { data } = await client.users.list({ project, instance });
    return (data.items ?? []).map((u) => ({
      name: u.name,
      type: u.type ?? 'BUILT_IN', // BUILT_IN | CLOUD_IAM_USER | CLOUD_IAM_SERVICE_ACCOUNT ...
      host: u.host ?? null,       // solo MySQL
    }));
  } catch (err) {
    throw new InfraError(`No se pudieron listar los usuarios de ${instance}`, { code: 'USER_LIST_FAILED', cause: err });
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
    // Vienen ordenadas de más reciente a más antigua; las en curso están arriba.
    const { data } = await client.operations.list({ project, instance, maxResults: 50 });
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

/** Filtra las operaciones que aún no terminaron (PENDING/RUNNING). Pura. */
export function activeOperations(items = []) {
  return items.filter((op) => op.status === 'PENDING' || op.status === 'RUNNING');
}

/**
 * Pre-check: espera a que la instancia no tenga operaciones en curso (backup
 * automático, otro import, mantenimiento...). Cloud SQL rechaza un import si hay
 * otra operación corriendo, y descubrirlo DESPUÉS del DROP deja la BD borrada.
 * @returns { ok: true } | { ok: false, busy: [{ name, operationType, status }] }
 */
export async function waitForInstanceIdle(
  { project, instance },
  { timeoutSeconds = 900, pollIntervalSeconds = 30, onWait } = {},
) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  for (;;) {
    const busy = activeOperations(await listOperations({ project, instance })).map((op) => ({
      name: op.name,
      operationType: op.operationType,
      status: op.status,
    }));
    if (busy.length === 0) return { ok: true };
    if (Date.now() >= deadline) return { ok: false, busy };
    if (onWait) await onWait(busy);
    await new Promise((r) => setTimeout(r, pollIntervalSeconds * 1000));
  }
}
