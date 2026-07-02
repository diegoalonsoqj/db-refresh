// Servicio de restauraciones programadas. Valida cron y mapping, hace CRUD y
// expone triggerSchedule() que el proceso scheduler usa para encolar el job
// (reutiliza restore.service para toda la validación de la restauración).
import cron from 'node-cron';
import * as repo from '../data/repositories/schedules.repo.js';
import * as catalogRepo from '../data/repositories/catalog.repo.js';
import * as restoreService from './restore.service.js';
import { mapPgError } from '../data/pgErrors.js';
import { NotFoundError, ValidationError } from '../domain/errors.js';
import { assertSafeName } from '../lib/validation.js';

/** Valida y normaliza el mapping [{ backupFile, targetDb }]. */
function validateMapping(mapping) {
  if (!Array.isArray(mapping) || mapping.length === 0) {
    throw new ValidationError('mapping vacío: indica al menos un backup -> BD');
  }
  return mapping.map((m) => ({
    backupFile: assertSafeName(m.backupFile ?? '', 'backupFile'),
    targetDb: assertSafeName(m.targetDb ?? '', 'targetDb'),
  }));
}

/** Valida referencias e insumos comunes de creación/edición. */
async function validateInput(input) {
  const instanceRef = input.instanceRef;
  const bucketRef = input.bucketRef;
  const instance = instanceRef ? await catalogRepo.getInstanceById(instanceRef) : null;
  if (!instance) throw new NotFoundError(`Instancia ${instanceRef} no encontrada`);
  const bucket = bucketRef ? await catalogRepo.getBucketById(bucketRef) : null;
  if (!bucket) throw new NotFoundError(`Bucket ${bucketRef} no encontrado`);

  if (typeof input.cronExpr !== 'string' || !cron.validate(input.cronExpr)) {
    throw new ValidationError(`cron_expr inválida: ${input.cronExpr}`);
  }

  return {
    instanceRef,
    bucketRef,
    cronExpr: input.cronExpr,
    mapping: validateMapping(input.mapping),
    isActive: input.isActive ?? true,
  };
}

export const listSchedules = () => repo.listSchedules();

export async function getSchedule(id) {
  const s = await repo.getById(id);
  if (!s) throw new NotFoundError(`Schedule ${id} no encontrado`);
  return s;
}

export async function createSchedule(input, createdBy = null) {
  const data = await validateInput(input);
  try {
    return await repo.createSchedule({ ...data, createdBy });
  } catch (err) {
    throw mapPgError(err, { entity: 'Schedule' });
  }
}

export async function updateSchedule(id, input) {
  await getSchedule(id);
  const data = await validateInput(input);
  try {
    return await repo.updateSchedule(id, data);
  } catch (err) {
    throw mapPgError(err, { entity: 'Schedule' });
  }
}

export async function deleteSchedule(id) {
  await getSchedule(id);
  await repo.deleteSchedule(id);
}

/** Construye el gs:// URI base a partir del bucket. */
function buildBucketPath(bucket) {
  const prefix = bucket.base_prefix ? `/${String(bucket.base_prefix).replace(/^\/+|\/+$/g, '')}` : '';
  return `gs://${bucket.bucket_name}${prefix}`;
}

/**
 * Encola un job de restauración a partir de un schedule (lo usa el scheduler y
 * el endpoint "run now"). Reutiliza restore.service.launchRestore para validar.
 */
export async function triggerSchedule(schedule) {
  const bucket = await catalogRepo.getBucketById(schedule.bucket_ref);
  if (!bucket) throw new NotFoundError(`Bucket ${schedule.bucket_ref} no encontrado`);

  const job = await restoreService.launchRestore({
    instanceId: schedule.instance_ref,
    bucketId: schedule.bucket_ref,
    bucketPath: buildBucketPath(bucket),
    mapping: schedule.mapping, // [{ backupFile, targetDb }]
    requestedBy: schedule.created_by ?? null,
  });

  await repo.markRun(schedule.id, new Date());
  return job;
}

/** Dispara un schedule por id (revalida existencia). */
export async function runScheduleNow(id) {
  const schedule = await getSchedule(id);
  return triggerSchedule(schedule);
}
