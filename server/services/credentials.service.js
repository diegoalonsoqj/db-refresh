// Credenciales SQL reutilizables (catálogo): CRUD, cifrado de la contraseña y
// prueba de conexión. La contraseña nunca se devuelve ni se loguea.
import * as repo from '../data/repositories/credentials.repo.js';
import * as catalogRepo from '../data/repositories/catalog.repo.js';
import { mapPgError } from '../data/pgErrors.js';
import { DomainError, NotFoundError, ValidationError } from '../domain/errors.js';
import { validateCredentialInput } from '../domain/credential.js';
import { encrypt } from '../lib/crypto.js';
import { connectionFor, resolveSqlConnection } from '../engines/sql/connection.js';
import { testSqlConnection } from '../engines/sql/runners.js';
import { describeGcpError } from '../gcp/cloudsql.client.js';

export const listCredentials = () => repo.listCredentials();

export async function getCredential(id) {
  const c = await repo.getCredentialById(id);
  if (!c) throw new NotFoundError(`Credencial ${id} no encontrada`);
  return c;
}

function encryptPassword(password) {
  try {
    return encrypt(password);
  } catch (err) {
    throw new DomainError(`No se pudo cifrar la contraseña: ${err.message}`, { code: 'ENCRYPTION_UNAVAILABLE' });
  }
}

function toRow(data, actorId) {
  return {
    ...data,
    passwordEnc: data.secretKind === 'stored' && data.password ? encryptPassword(data.password) : null,
    secretRef: data.secretKind === 'ref' ? data.secretRef : null,
    updatedBy: actorId ?? null,
  };
}

export async function createCredential(input, actorId) {
  const data = validateCredentialInput(input, null);
  try {
    return await repo.createCredential(toRow(data, actorId));
  } catch (err) {
    throw mapPgError(err, { entity: 'Credencial' });
  }
}

export async function updateCredential(id, input, actorId) {
  const existing = await getCredential(id);
  const data = validateCredentialInput(input, existing);
  // Cambiar el motor dejaría instancias apuntando a una credencial de otro motor.
  if (data.engine !== existing.engine && existing.instance_count > 0) {
    throw new ValidationError(
      `No se puede cambiar el motor: la credencial la usan ${existing.instance_count} instancia(s)`,
    );
  }
  try {
    return await repo.updateCredential(id, toRow(data, actorId));
  } catch (err) {
    throw mapPgError(err, { entity: 'Credencial' });
  }
}

export async function deleteCredential(id) {
  const existing = await getCredential(id);
  if (existing.instance_count > 0) {
    throw mapPgError({ code: '23503' }, { entity: `Credencial (la usan ${existing.instance_count} instancia(s))` });
  }
  try {
    await repo.deleteCredential(id);
  } catch (err) {
    throw mapPgError(err, { entity: 'Credencial' });
  }
}

/** Ejecuta login + SELECT 1. Nunca lanza: devuelve { ok, message|error, latencyMs }. */
async function runTest(getConn) {
  const started = Date.now();
  try {
    const conn = await getConn();
    await testSqlConnection(conn);
    return { ok: true, message: `Conexión correcta (${conn.label})`, latencyMs: Date.now() - started };
  } catch (err) {
    const reason = describeGcpError(err.cause);
    return { ok: false, error: reason && !err.message.includes(reason) ? `${err.message} — ${reason}` : err.message };
  }
}

/** Prueba una credencial contra un host/puerto (p.ej. desde el formulario de instancia). */
export async function testCredential(id, { host, port } = {}) {
  await getCredential(id);
  const h = typeof host === 'string' ? host.trim() : '';
  if (!h) throw new ValidationError('host es obligatorio para probar la conexión');
  const p = port ? Number(port) : null;
  if (p !== null && !(Number.isInteger(p) && p > 0 && p < 65536)) throw new ValidationError(`port inválido: ${port}`);
  return runTest(() => connectionFor({ host: h, port: p, credentialId: id }));
}

/** Prueba la conexión SQL guardada de una instancia del catálogo. */
export async function testInstanceConnection(instanceId) {
  const instance = await catalogRepo.getInstanceById(instanceId);
  if (!instance) throw new NotFoundError(`Instancia ${instanceId} no encontrada`);
  return runTest(() => resolveSqlConnection(instance));
}
