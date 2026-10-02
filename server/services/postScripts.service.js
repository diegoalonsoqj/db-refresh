// Post-scripts SQL por instancia: CRUD + validación. La ejecución la hace el
// adaptador de motor (runPostScripts) desde el worker.
import * as repo from '../data/repositories/postScripts.repo.js';
import { getInstance } from './catalog.service.js';
import { mapPgError } from '../data/pgErrors.js';
import { NotFoundError, ValidationError } from '../domain/errors.js';
import { assertNonEmpty, assertSafeName } from '../lib/validation.js';
import { splitSqlBatches } from '../lib/sqlBatches.js';

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
  await getInstance(instanceId);
  const data = validate(input);
  try {
    return await repo.create(instanceId, data);
  } catch (err) {
    throw mapPgError(err, { entity: 'Post-script' });
  }
}

export async function update(instanceId, scriptId, input) {
  await getScript(instanceId, scriptId);
  const data = validate(input);
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
