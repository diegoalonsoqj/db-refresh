// Tareas de restore (modelo de db-keeper): CRUD de la tarea (qué restaurar),
// su programación (cuándo) y el disparo, que el scheduler y «Ejecutar ahora»
// comparten. Disparar = resolver los patrones al backup más reciente de la
// carpeta y encolar un restore con restore.service.launchRestore (el worker es
// el único que ejecuta).
import { config } from '../config/index.js';
import * as repo from '../data/repositories/schedules.repo.js';
import * as catalogRepo from '../data/repositories/catalog.repo.js';
import * as restoreService from './restore.service.js';
import * as backupService from './backup.service.js';
import { parseGsUri } from '../gcp/storage.client.js';
import { mapPgError } from '../data/pgErrors.js';
import { NotFoundError, ValidationError } from '../domain/errors.js';
import { missingSqlCredentials } from '../domain/instance.js';
import { buildSchedule, resolveTaskMapping, validateTaskMapping } from '../domain/restoreTask.js';

/** Carpeta base del bucket como gs:// URI. */
export function bucketBasePath(bucket) {
  const prefix = bucket.base_prefix ? `/${String(bucket.base_prefix).replace(/^\/+|\/+$/g, '')}` : '';
  return `gs://${bucket.bucket_name}${prefix}`;
}

/** Valida y normaliza la definición de una tarea. */
async function validateInput(input) {
  const name = String(input?.name ?? '').trim();
  if (!name) throw new ValidationError('Indica un nombre para la tarea');
  if (name.length > 120) throw new ValidationError('El nombre de la tarea es demasiado largo (máx. 120)');

  const instance = input.instanceRef ? await catalogRepo.getInstanceById(input.instanceRef) : null;
  if (!instance) throw new NotFoundError(`Instancia ${input.instanceRef} no encontrada`);
  const bucket = input.bucketRef ? await catalogRepo.getBucketById(input.bucketRef) : null;
  if (!bucket) throw new NotFoundError(`Bucket ${input.bucketRef} no encontrado`);

  // Carpeta: la base del bucket o una subcarpeta suya (como en Lanzar restore).
  const base = bucketBasePath(bucket);
  const bucketPath = String(input.bucketPath ?? '').trim().replace(/\/+$/, '') || base;
  parseGsUri(bucketPath);
  if (bucketPath !== base && !bucketPath.startsWith(`${base}/`)) {
    throw new ValidationError(`La carpeta debe estar dentro de ${base}`);
  }

  const method = input.method ?? 'import';
  const mapping = validateTaskMapping(instance.engine, input.mapping, method);
  const skipSqlOnFailure = input.skipSqlOnFailure === true;
  if (skipSqlOnFailure && method === 'native') {
    throw new ValidationError('«Continuar aunque falle la conexión SQL» no aplica al restore nativo: necesita la conexión para restaurar');
  }
  // Lo que se hace por SQL exige la conexión de la instancia (mismas reglas que al lanzar).
  const sqlNeed = method === 'native' ? 'El restore nativo'
    : mapping.some((m) => m.dropViaSql) ? 'El borrado de BD por SQL'
    : mapping.some((m) => m.importUser) ? 'Asignar el owner de la BD (import en PostgreSQL)' : null;
  if (sqlNeed && missingSqlCredentials(instance).length) {
    throw new ValidationError(
      `${sqlNeed} necesita la conexión SQL de la instancia (IP privada + credencial): configúrala en Catálogo → Instancias`,
    );
  }

  return {
    name,
    instanceRef: instance.id,
    bucketRef: bucket.id,
    bucketPath: bucketPath === base ? null : bucketPath,
    method,
    mapping,
    skipSqlOnFailure,
  };
}

export const listSchedules = () => repo.listSchedules();

export async function getSchedule(id) {
  const s = await repo.getById(id);
  if (!s) throw new NotFoundError(`Tarea ${id} no encontrada`);
  return s;
}

/** Crea una tarea sin programar (la fecha/hora se fija después con setTaskSchedule). */
export async function createSchedule(input, createdBy = null) {
  const data = await validateInput(input);
  try {
    return await repo.createSchedule({ ...data, createdBy, timezone: config.scheduler.timezone });
  } catch (err) {
    throw mapPgError(err, { entity: 'Tarea' });
  }
}

export async function updateSchedule(id, input) {
  await getSchedule(id);
  const data = await validateInput(input);
  try {
    return await repo.updateSchedule(id, data);
  } catch (err) {
    throw mapPgError(err, { entity: 'Tarea' });
  }
}

export async function deleteSchedule(id) {
  await getSchedule(id);
  await repo.deleteSchedule(id);
}

/**
 * Programa la tarea: { mode: 'none' } | { mode: 'once', runAt: 'AAAA-MM-DDTHH:MM' }
 * | { mode: 'recurring', cron }, con `timezone` opcional (por defecto la de config).
 */
export async function setTaskSchedule(id, input, now = new Date()) {
  await getSchedule(id);
  return repo.setSchedule(id, buildSchedule(input, now, config.scheduler.timezone));
}

/** Carpeta efectiva de la tarea (la suya o la base del bucket). */
async function taskFolder(task) {
  if (task.bucket_path) return task.bucket_path;
  const bucket = await catalogRepo.getBucketById(task.bucket_ref);
  if (!bucket) throw new NotFoundError(`Bucket ${task.bucket_ref} no encontrado`);
  return bucketBasePath(bucket);
}

/**
 * Encola el restore de una tarea. Resuelve cada patrón al backup más reciente
 * de su carpeta; si alguno no encaja, falla sin encolar nada. Deja constancia
 * del resultado en la tarea (último job o último error).
 */
export async function triggerSchedule(task, now = new Date()) {
  try {
    const bucketPath = await taskFolder(task);
    const needsListing = task.mapping.some((m) => m.source === 'latest');
    const method = task.method ?? 'import';
    const files = needsListing ? (await backupService.listBackups(task.instance_ref, bucketPath, method)).files : [];
    const job = await restoreService.launchRestore({
      instanceId: task.instance_ref,
      bucketId: task.bucket_ref,
      bucketPath,
      method,
      mapping: resolveTaskMapping(task.mapping, files),
      skipSqlOnFailure: task.skip_sql_on_failure,
      requestedBy: task.created_by ?? null,
    });
    await repo.recordRun(task.id, { lastRunAt: now, jobId: job.id });
    return job;
  } catch (err) {
    await repo.recordRun(task.id, { lastRunAt: now, error: err.message }).catch(() => {});
    throw err;
  }
}

/** «Ejecutar ahora»: dispara la tarea sin tocar su programación. */
export async function runScheduleNow(id) {
  return triggerSchedule(await getSchedule(id));
}

/**
 * Vista previa: a qué backup apunta hoy cada fila de la tarea (para la UI).
 * @returns [{ targetDb, source, pattern, backupFile|null }]
 */
export async function previewSchedule(id) {
  const task = await getSchedule(id);
  const bucketPath = await taskFolder(task);
  const { files } = await backupService.listBackups(task.instance_ref, bucketPath, task.method ?? 'import');
  const names = new Set(files.map((f) => f.fileName));
  return task.mapping.map((m) => {
    if (m.source !== 'latest') return { ...m, found: names.has(m.backupFile) };
    try {
      const [row] = resolveTaskMapping([m], files);
      return { ...m, backupFile: row.backupFile, found: true };
    } catch {
      return { ...m, backupFile: null, found: false };
    }
  });
}
