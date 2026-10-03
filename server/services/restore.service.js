// Servicio de restauración: valida la solicitud y encola un job.
// La ejecución real corre en el worker (async, desacoplada del request).
import * as catalogRepo from '../data/repositories/catalog.repo.js';
import * as jobsRepo from '../data/repositories/jobs.repo.js';
import { parseGsUri } from '../gcp/storage.client.js';
import { NotFoundError, ValidationError } from '../domain/errors.js';
import { validateMapping } from '../domain/restoreMapping.js';
import { missingSqlCredentials } from '../domain/instance.js';

/**
 * Crea (encola) un job de restauración.
 * @param {object} req { instanceId, bucketPath, method?, mapping: [{backupFile, targetDb, importUser?, scope?, schemaName?}], requestedBy }
 */
export async function launchRestore(req) {
  const instance = await catalogRepo.getInstanceById(req.instanceId);
  if (!instance) throw new NotFoundError(`Instancia ${req.instanceId} no encontrada`);
  if (!instance.is_active) throw new ValidationError('La instancia está inactiva');

  if (!req.bucketPath) throw new ValidationError('bucketPath es obligatorio');
  parseGsUri(req.bucketPath); // valida formato gs://

  // Validación/sanitización: método, nombres de archivo/BD, BDs de sistema, owner (solo PG),
  // alcance/esquema (solo nativo).
  const method = req.method ?? 'import';
  const items = validateMapping(instance.engine, req.mapping, method).map((m, idx) => ({ ...m, seq: idx + 1 }));
  // El restore nativo se conecta por SQL a la IP privada: exige la conexión de la instancia.
  if (method === 'native' && missingSqlCredentials(instance).length) {
    throw new ValidationError(
      'El restore nativo necesita la conexión SQL de la instancia (IP privada + credencial): configúrala en Catálogo → Instancias',
    );
  }

  const job = await jobsRepo.createJob(
    {
      instanceId: instance.id,
      bucketId: req.bucketId ?? null,
      engine: instance.engine,
      requestedBy: req.requestedBy ?? null,
      bucketPath: req.bucketPath,
      method,
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
