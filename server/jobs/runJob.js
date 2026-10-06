// Ejecuta un job de restauración completo. Orquesta el adaptador de motor,
// persiste estado/eventos y publica progreso. Reproduce el flujo de
// restore_to_csql.py: pre-check -> pre-scripts -> validar -> drop -> import (por item) -> post-scripts.
import * as jobsRepo from '../data/repositories/jobs.repo.js';
import * as catalogRepo from '../data/repositories/catalog.repo.js';
import { listActiveForInstance } from '../services/postScripts.service.js';
import { createAdapter } from '../engines/index.js';
import { publish } from './progress.js';
import { DomainError, JobCancelledError } from '../domain/errors.js';
import { throwIfCancelled, watchCancel } from '../lib/cancel.js';
import { describeGcpError } from '../gcp/cloudsql.client.js';

/** Añade el motivo de la causa salvo que el mensaje ya lo contenga (evita repetirlo). */
export function withReason(message, reason) {
  return reason && !String(message).includes(reason) ? `${message} — ${reason}` : message;
}

/** Crea el logger de eventos ligado a un job (persiste + publica para SSE). */
function makeLogger(jobId) {
  return async (level, message, { itemId = null } = {}) => {
    const event = await jobsRepo.addEvent(jobId, { itemId, level, message });
    publish(jobId, event);
  };
}

/** Cada cuánto consulta el worker si se pidió cancelar el job. */
const CANCEL_POLL_MS = 5000;

export async function runJob(job, logger) {
  // La API marca la petición de cancelación en la BD; aquí se convierte en un AbortSignal.
  const cancel = watchCancel(() => jobsRepo.isCancelRequested(job.id), {
    intervalMs: CANCEL_POLL_MS,
    onError: (err) => logger?.warn({ err, jobId: job.id }, 'No se pudo consultar la cancelación'),
  });
  try {
    if (job.cancel_requested_at) cancel.abort();
    await runJobSteps(job, logger, cancel.signal);
  } finally {
    cancel.stop();
  }
}

async function runJobSteps(job, logger, signal) {
  const log = makeLogger(job.id);
  logger?.info({ jobId: job.id }, 'Ejecutando job');

  const instance = await catalogRepo.getInstanceById(job.instance_ref);
  if (!instance) {
    await log('error', `Instancia ${job.instance_ref} no encontrada`);
    await jobsRepo.finishJob(job.id, 'failed', 'Instancia no encontrada');
    return;
  }

  const ctx = {
    instance,
    project: instance.project_id,
    bucketPath: job.bucket_path,
    log,
    preScripts: await listActiveForInstance(instance.id, 'pre'),
    postScripts: await listActiveForInstance(instance.id, 'post'),
    skipSqlOnFailure: job.skip_sql_on_failure === true,
    signal,
    reportOperation: (itemId, operation) =>
      jobsRepo.updateItemStatus(itemId, 'importing', { gcpOperation: operation }),
  };

  let adapter;
  try {
    adapter = createAdapter(job.engine, ctx, job.method ?? 'import');
  } catch (err) {
    await log('error', err.message);
    await jobsRepo.finishJob(job.id, 'failed', err.message);
    return;
  }

  const items = await jobsRepo.getJobItems(job.id);
  const methodLabel = job.method === 'native' ? 'restore nativo (pg_restore/psql)' : 'import de Cloud SQL';
  await log('info', `Inicio de la restauración: ${items.length} BD, ${methodLabel}.`);

  // Aborta el job antes del primer DROP: todos los items quedan como fallidos
  // (o cancelados, si lo pidió el usuario).
  const abortBeforeRestore = async (stage, err, detail) => {
    if (err instanceof JobCancelledError) {
      const message = `Cancelado por el usuario durante ${stage.toLowerCase()}; ${detail}.`;
      await log('warning', message);
      for (const item of items) {
        await jobsRepo.updateItemStatus(item.id, 'cancelled', { markFinished: true });
      }
      await jobsRepo.finishJob(job.id, 'cancelled', message);
      await log('info', 'Proceso finalizado.');
      return;
    }
    const message = withReason(err.message, describeGcpError(err.cause));
    logger?.error({ err, jobId: job.id }, `${stage} fallido`);
    await log('error', `${stage} fallido; ${detail}: ${message}`);
    for (const item of items) {
      await jobsRepo.updateItemStatus(item.id, 'failed', {
        errorMessage: `${stage}: ${message}`,
        markFinished: true,
      });
    }
    await jobsRepo.finishJob(job.id, 'failed', `${stage}: ${message}`);
    await log('info', 'Proceso finalizado.');
  };

  // 0) Pre-check: todos los backups existen + instancia libre + conexión para
  //    pre/post-scripts. Si falla, el job termina sin haber borrado nada (todos los
  //    items quedan como fallidos), como hacía el script original.
  try {
    for (const item of items) await adapter.validateBackup(item.backup_file);
    await log('info', `Pre-check: ${items.length} backup(s) validados en GCS.`);
    await adapter.preflight(items);
    throwIfCancelled(signal);
  } catch (err) {
    await abortBeforeRestore('Pre-check', err, 'no se ha modificado ninguna BD');
    return;
  }

  // 0b) Pre-scripts: una vez por job, antes del primer DROP. Si uno falla, el
  //     resto no se ejecuta y el job se aborta sin borrar ni restaurar ninguna BD.
  if (adapter.preScripts.length) {
    try {
      await log('info', `Ejecutando ${adapter.preScripts.length} pre-script(s).`);
      await adapter.runPreScripts();
      throwIfCancelled(signal);
    } catch (err) {
      await abortBeforeRestore('Pre-scripts', err, 'no se ha borrado ni restaurado ninguna BD');
      return;
    }
  }

  let allOk = true;
  let firstError = null; // se muestra como error del job (además del log)
  const warnings = new Set(); // pasos omitidos: el job termina "OK con avisos"
  let cancelled = null; // mensaje si el usuario canceló el job

  for (const [idx, item] of items.entries()) {
    let touched = false; // ¿ya se borró/modificó la BD destino de este item?
    try {
      throwIfCancelled(signal);
      // Entre items puede colarse otra operación (backup automático, otro job):
      // re-chequear antes de cada DROP. El primero ya lo cubrió el pre-check.
      // También puede haberse detenido la instancia mientras se restauraba la BD anterior.
      if (idx > 0) {
        await adapter.assertInstanceRunning();
        await adapter.waitInstanceIdle({ itemId: item.id });
      }

      // 1) Validar backup
      await jobsRepo.updateItemStatus(item.id, 'pending', { markStarted: true });
      await adapter.validateBackup(item.backup_file);

      // 2) DROP destructivo del destino
      await jobsRepo.updateItemStatus(item.id, 'dropping');
      touched = true;
      await adapter.prepareTarget(item.target_db, item);
      throwIfCancelled(signal);

      // 3) Import + espera
      await jobsRepo.updateItemStatus(item.id, 'importing', { markStarted: true });
      const res = await adapter.restore(item);
      // Cancelado durante el import: si Cloud SQL llegó a terminarlo, la BD está completa.
      if (res.aborted && !res.ok) throw new JobCancelledError();

      if (res.ok) {
        await log('info', `Restauración completada: ${item.target_db}.`, { itemId: item.id });
        // Tras restaurar: corrección de usuarios huérfanos (SQL Server). Sus fallos
        // son avisos; la restauración sigue contando como correcta.
        if (item.fix_orphans && adapter.fixOrphans) {
          if (adapter.sqlUnavailable) {
            warnings.add('se omitió la corrección de usuarios huérfanos');
            await log('warning', `Corrección de usuarios huérfanos de ${item.target_db} omitida: no hay conexión SQL.`, { itemId: item.id });
          } else {
            await adapter.fixOrphans(item);
          }
        }
        await jobsRepo.updateItemStatus(item.id, 'succeeded', { markFinished: true });
      } else {
        allOk = false;
        const msg = describeGcpError(res.error) || JSON.stringify(res.error ?? {});
        firstError ??= `${item.target_db}: ${msg}`;
        await jobsRepo.updateItemStatus(item.id, 'failed', { errorMessage: msg, markFinished: true });
        await log('error', `Restauración fallida: ${item.target_db}: ${msg}`, { itemId: item.id });
      }
    } catch (err) {
      allOk = false;
      if (err instanceof JobCancelledError) {
        cancelled = touched
          ? `Cancelado por el usuario durante la restauración de ${item.target_db}: la BD puede haber quedado vacía o incompleta.`
          : `Cancelado por el usuario antes de restaurar ${item.target_db}.`;
        await jobsRepo.updateItemStatus(item.id, 'cancelled', {
          errorMessage: touched ? 'Cancelado: la BD puede haber quedado vacía o incompleta' : null,
          markFinished: true,
        });
        await log('warning', cancelled, { itemId: item.id });
        for (const rest of items.slice(idx + 1)) {
          await jobsRepo.updateItemStatus(rest.id, 'cancelled', { markFinished: true });
        }
        break;
      }
      const domain = err instanceof DomainError;
      // El motivo real (p.ej. el error de la operación de Cloud SQL) va en `cause`.
      const reason = describeGcpError(err.cause);
      const message = withReason(err.message, reason);
      firstError ??= `${item.target_db}: ${message}`;
      logger?.error({ err, jobId: job.id, itemId: item.id }, 'Item fallido');
      await jobsRepo.updateItemStatus(item.id, 'failed', {
        errorMessage: message,
        markFinished: true,
      });
      await log(domain ? 'warning' : 'error', `${item.target_db}: ${message}`, {
        itemId: item.id,
      });
    }
  }

  if (!cancelled && allOk && signal.aborted) {
    cancelled = 'Cancelado por el usuario tras restaurar todas las BD; no se ejecutaron los post-scripts.';
    await log('warning', cancelled);
  }
  if (cancelled) {
    await jobsRepo.finishJob(job.id, 'cancelled', cancelled);
    await log('info', 'Proceso finalizado.');
    return;
  }

  // 4) Post-scripts solo si TODO salió OK (igual que el script original)
  if (allOk && adapter.postScripts.length === 0) {
    await log('info', 'La instancia no tiene post-scripts configurados.');
  } else if (allOk && adapter.sqlUnavailable) {
    warnings.add(`no se ejecutaron ${adapter.postScripts.length} post-script(s)`);
    await log('warning', `No se ejecutan los ${adapter.postScripts.length} post-script(s): no hay conexión SQL. Ejecútalos cuando se restablezca (Catálogo → Instancias → Post-scripts → Ejecutar).`);
  } else if (allOk) {
    try {
      await log('info', `Restauraciones completadas. Ejecutando ${adapter.postScripts.length} post-script(s).`);
      await adapter.runPostScripts();
    } catch (err) {
      allOk = false;
      firstError ??= `Post-scripts: ${err.message}`;
      await log('error', `Los post-scripts fallaron: ${err.message}`);
    }
  } else {
    await log('warning', 'No se ejecutan los post-scripts: hubo restauraciones fallidas.');
  }

  const warning = warnings.size
    ? `Sin conexión SQL (${adapter.sqlUnavailable}): ${[...warnings].join(' y ')}.`
    : null;
  await jobsRepo.finishJob(
    job.id,
    allOk ? 'succeeded' : 'failed',
    allOk ? null : (firstError ?? 'Ver eventos del job'),
    warning,
  );
  await log('info', 'Proceso finalizado.');
}
