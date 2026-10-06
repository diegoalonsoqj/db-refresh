// Servicio de restauración: valida la solicitud y encola un job.
// La ejecución real corre en el worker (async, desacoplada del request).
import * as catalogRepo from '../data/repositories/catalog.repo.js';
import * as jobsRepo from '../data/repositories/jobs.repo.js';
import { parseGsUri } from '../gcp/storage.client.js';
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors.js';
import { validateMapping } from '../domain/restoreMapping.js';
import { missingSqlCredentials } from '../domain/instance.js';
import { getUserById } from '../data/repositories/users.repo.js';

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
  // Continuar sin conexión SQL: solo con el import de Cloud SQL (el nativo restaura por SQL).
  const skipSqlOnFailure = req.skipSqlOnFailure === true;
  if (skipSqlOnFailure && method === 'native') {
    throw new ValidationError('«Continuar aunque falle la conexión SQL» no aplica al restore nativo: necesita la conexión para restaurar');
  }
  // El restore nativo y la corrección de huérfanos se conectan por SQL a la IP privada:
  // exigen la conexión de la instancia.
  if (missingSqlCredentials(instance).length) {
    const why = method === 'native' ? 'El restore nativo'
      : items.some((it) => it.dropViaSql) ? 'El borrado de BD por SQL'
      : items.some((it) => it.importUser) ? 'Asignar el owner de la BD (import en PostgreSQL)'
      : items.some((it) => it.fixOrphans) && !skipSqlOnFailure ? 'La corrección de usuarios huérfanos' : null;
    if (why) {
      throw new ValidationError(
        `${why} necesita la conexión SQL de la instancia (IP privada + credencial): configúrala en Catálogo → Instancias`,
      );
    }
  }

  const job = await jobsRepo.createJob(
    {
      instanceId: instance.id,
      bucketId: req.bucketId ?? null,
      engine: instance.engine,
      requestedBy: req.requestedBy ?? null,
      bucketPath: req.bucketPath,
      method,
      skipSqlOnFailure,
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

/**
 * Cancela un job. Pendiente: se cancela al momento (no se ha tocado nada).
 * En curso: se marca la petición y el worker la atiende en segundos (cancela la
 * operación de Cloud SQL en curso o detiene pg_restore/psql); el job queda 'cancelled'.
 * @returns { status, cancelRequested }
 */
export async function cancelJob(jobId, actor) {
  const user = actor?.id ? await getUserById(actor.id).catch(() => null) : null;
  const who = user?.full_name || user?.username || user?.email || actor?.email || 'un usuario';

  const cancelled = await jobsRepo.cancelPendingJob(jobId, actor?.id, `Cancelado por ${who} antes de empezar.`);
  if (cancelled) {
    await jobsRepo.addEvent(jobId, { level: 'warning', message: `Job cancelado por ${who} antes de empezar; no se ha modificado ninguna BD.` });
    return { status: 'cancelled', cancelRequested: true };
  }
  // Ya no estaba pendiente (o el worker acaba de tomarlo): pedir la cancelación al worker.
  if (await jobsRepo.requestCancel(jobId, actor?.id)) {
    await jobsRepo.addEvent(jobId, { level: 'warning', message: `Cancelación solicitada por ${who}.` });
    return { status: 'running', cancelRequested: true };
  }
  const job = await jobsRepo.getJobWithItems(jobId);
  if (!job) throw new NotFoundError('Job no encontrado');
  if (job.status === 'running') return { status: 'running', cancelRequested: true }; // ya pedida
  throw new ConflictError(`El job ya terminó (${job.status}); no se puede cancelar`, { code: 'JOB_FINISHED' });
}
