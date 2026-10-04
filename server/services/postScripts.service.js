// Post-scripts SQL por instancia: CRUD + validación. La ejecución la hace el
// adaptador de motor (runPostScripts) desde el worker.
import * as repo from '../data/repositories/postScripts.repo.js';
import { getInstance } from './catalog.service.js';
import { mapPgError } from '../data/pgErrors.js';
import { NotFoundError, ValidationError } from '../domain/errors.js';
import { assertNonEmpty, assertSafeName } from '../lib/validation.js';
import { splitSqlBatches } from '../lib/sqlBatches.js';
import { missingSqlCredentials } from '../domain/instance.js';
import { sqlRunnerFor } from '../engines/sql/runners.js';
import { resolveSqlConnection } from '../engines/sql/connection.js';
import { runPostScript } from '../engines/sql/postScriptRunner.js';
import { describeGcpError } from '../gcp/cloudsql.client.js';

const MAX_SQL_CHARS = 100_000; // el body JSON ya está limitado a 256kb

function validate(input = {}) {
  const sqlText = assertNonEmpty(input.sqlText, 'sqlText');
  if (sqlText.length > MAX_SQL_CHARS) {
    throw new ValidationError(`sqlText supera ${MAX_SQL_CHARS} caracteres`);
  }
  if (splitSqlBatches(sqlText).length === 0) {
    throw new ValidationError('sqlText no contiene ningún lote ejecutable');
  }
  const db = typeof input.databaseName === 'string' ? input.databaseName.trim() : '';
  const sortOrder = input.sortOrder ?? 0;
  if (!Number.isInteger(sortOrder)) throw new ValidationError('sortOrder debe ser entero');
  return {
    name: assertNonEmpty(input.name, 'name'),
    databaseName: db ? assertSafeName(db, 'databaseName') : null,
    sqlText,
    sortOrder,
    isActive: input.isActive ?? true,
  };
}

// Un post-script activo se ejecuta con la conexión SQL de la instancia: exigirla.
function assertInstanceCanRun(instance, data) {
  if (!data.isActive || !missingSqlCredentials(instance).length) return;
  throw new ValidationError(
    'La instancia no tiene conexión SQL (host y credencial): configúrala en ' +
      'Catálogo → Instancias o guarda el post-script como inactivo',
  );
}

export async function listForInstance(instanceId) {
  await getInstance(instanceId);
  return repo.listForInstance(instanceId);
}

/** Uso interno (worker): solo los activos, en orden de ejecución. */
export const listActiveForInstance = (instanceId) =>
  repo.listForInstance(instanceId, { onlyActive: true });

async function getScript(instanceId, scriptId) {
  const s = await repo.getById(scriptId);
  if (!s || s.instance_ref !== instanceId) {
    throw new NotFoundError(`Post-script ${scriptId} no encontrado`);
  }
  return s;
}

export async function create(instanceId, input) {
  const instance = await getInstance(instanceId);
  const data = validate(input);
  assertInstanceCanRun(instance, data);
  try {
    return await repo.create(instanceId, data);
  } catch (err) {
    throw mapPgError(err, { entity: 'Post-script' });
  }
}

export async function update(instanceId, scriptId, input) {
  await getScript(instanceId, scriptId);
  const data = validate(input);
  assertInstanceCanRun(await getInstance(instanceId), data);
  try {
    return await repo.update(scriptId, data);
  } catch (err) {
    throw mapPgError(err, { entity: 'Post-script' });
  }
}

export async function remove(instanceId, scriptId) {
  await getScript(instanceId, scriptId);
  await repo.remove(scriptId);
}

/**
 * Ejecuta YA un post-script guardado (botón "Ejecutar" del modal), aunque esté
 * inactivo, con la conexión SQL de la instancia. Nunca lanza por fallos del
 * script: devuelve la salida (PRINT/NOTICE y tablas) y el error para mostrarlos.
 * -> { ok, lines: [{ level, message }], error|null, durationMs }
 */
export async function runNow(instanceId, scriptId) {
  const instance = await getInstance(instanceId);
  const script = await getScript(instanceId, scriptId);
  const runner = sqlRunnerFor(instance.engine);
  if (!runner) throw new ValidationError(`Post-scripts no soportados para ${instance.engine}`);
  if (missingSqlCredentials(instance).length) {
    throw new ValidationError('La instancia no tiene conexión SQL (IP privada + credencial): configúrala para ejecutar scripts');
  }
  const lines = [];
  const log = async (level, message) => { lines.push({ level, message }); };
  const started = Date.now();
  try {
    const conn = await resolveSqlConnection(instance);
    await runPostScript({ runner, conn, script, log });
    return { ok: true, lines, error: null, durationMs: Date.now() - started };
  } catch (err) {
    const reason = describeGcpError(err.cause);
    const error = reason && !err.message.includes(reason) ? `${err.message} — ${reason}` : err.message;
    lines.push({ level: 'error', message: error });
    return { ok: false, lines, error, durationMs: Date.now() - started };
  }
}
