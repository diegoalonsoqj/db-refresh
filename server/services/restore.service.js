// Servicio de restauración: valida la solicitud y encola un job.
// La ejecución real corre en el worker (async, desacoplada del request).
import * as catalogRepo from '../data/repositories/catalog.repo.js';
import * as jobsRepo from '../data/repositories/jobs.repo.js';
import { parseGsUri } from '../gcp/storage.client.js';
import { NotFoundError, ValidationError } from '../domain/errors.js';

const SAFE_NAME = /^[A-Za-z0-9._-]+$/; // nombres de archivo / BD

/**
 * Crea (encola) un job de restauración.
 * @param {object} req { instanceId, bucketPath, mapping: [{backupFile, targetDb}], requestedBy }
 */
export async function launchRestore(req) {
  const instance = await catalogRepo.getInstanceById(req.instanceId);
  if (!instance) throw new NotFoundError(`Instancia ${req.instanceId} no encontrada`);
  if (!instance.is_active) throw new ValidationError('La instancia está inactiva');

  if (!req.bucketPath) throw new ValidationError('bucketPath es obligatorio');
  parseGsUri(req.bucketPath); // valida formato gs://

  if (!Array.isArray(req.mapping) || req.mapping.length === 0) {
    throw new ValidationError('mapping vacío: indica al menos un backup -> BD');
  }

  // Validación/sanitización de entradas (nombres de archivo y BD).
  const items = req.mapping.map((m, idx) => {
    if (!SAFE_NAME.test(m.backupFile ?? '')) {
      throw new ValidationError(`Nombre de backup inválido: ${m.backupFile}`);
    }
    if (!SAFE_NAME.test(m.targetDb ?? '')) {
      throw new ValidationError(`Nombre de BD inválido: ${m.targetDb}`);
    }
    return { backupFile: m.backupFile, targetDb: m.targetDb, seq: idx + 1 };
  });

  const job = await jobsRepo.createJob(
    {
      instanceId: instance.id,
      bucketId: req.bucketId ?? null,
      engine: instance.engine,
      requestedBy: req.requestedBy ?? null,
      bucketPath: req.bucketPath,
    },
    items,
  );

  return job;
}

export function listJobs() {
  return jobsRepo.listJobs();
}

export function getJob(jobId) {
  return jobsRepo.getJobWithItems(jobId);
}

export function getJobEvents(jobId, sinceId = 0) {
  return jobsRepo.getEventsSince(jobId, sinceId);
}
