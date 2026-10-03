// Ejecuta un job de restauración completo. Orquesta el adaptador de motor,
// persiste estado/eventos y publica progreso. Reproduce el flujo de
// restore_to_csql.py: pre-check -> validar -> drop -> import (por item) -> post-scripts.
import * as jobsRepo from '../data/repositories/jobs.repo.js';
import * as catalogRepo from '../data/repositories/catalog.repo.js';
import { listActiveForInstance } from '../services/postScripts.service.js';
import { createAdapter } from '../engines/index.js';
import { publish } from './progress.js';
import { DomainError } from '../domain/errors.js';
import { describeGcpError } from '../gcp/cloudsql.client.js';

/** Crea el logger de eventos ligado a un job (persiste + publica para SSE). */
function makeLogger(jobId) {
  return async (level, message, { itemId = null } = {}) => {
    const event = await jobsRepo.addEvent(jobId, { itemId, level, message });
    publish(jobId, event);
  };
}

export async function runJob(job, logger) {
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
    postScripts: await listActiveForInstance(instance.id),
    reportOperation: (itemId, operation) =>
      jobsRepo.updateItemStatus(itemId, 'importing', { gcpOperation: operation }),
  };

  let adapter;
  try {
    adapter = createAdapter(job.engine, ctx);
  } catch (err) {
    await log('error', err.message);
    await jobsRepo.finishJob(job.id, 'failed', err.message);
    return;
  }

  const items = await jobsRepo.getJobItems(job.id);
  await log('info', `=== 🔰 Inicio de restauración (${items.length} BD) ===`);

  // 0) Pre-check: todos los backups existen + instancia libre + conexión para
  //    post-scripts. Si falla, el job termina sin haber borrado nada (todos los
  //    items quedan como fallidos), como hacía el script original.
  try {
    for (const item of items) await adapter.validateBackup(item.backup_file);
    await log('info', `✅ ${items.length} backup(s) validados en GCS.`);
    await adapter.preflight();
  } catch (err) {
    const reason = describeGcpError(err.cause);
    const message = reason ? `${err.message} — ${reason}` : err.message;
    logger?.error({ err, jobId: job.id }, 'Pre-check fallido');
    await log('error', `❌ Pre-check fallido, no se toca ninguna BD: ${message}`);
    for (const item of items) {
      await jobsRepo.updateItemStatus(item.id, 'failed', {
        errorMessage: `Pre-check: ${message}`,
        markFinished: true,
      });
    }
    await jobsRepo.finishJob(job.id, 'failed', `Pre-check: ${message}`);
    await log('info', '=== 🏁 Proceso completado ===');
    return;
  }

  let allOk = true;
  let firstError = null; // se muestra como error del job (además del log)

  for (const [idx, item] of items.entries()) {
    try {
      // Entre items puede colarse otra operación (backup automático, otro job):
      // re-chequear antes de cada DROP. El primero ya lo cubrió el pre-check.
      if (idx > 0) await adapter.waitInstanceIdle({ itemId: item.id });

      // 1) Validar backup
      await jobsRepo.updateItemStatus(item.id, 'pending', { markStarted: true });
      await adapter.validateBackup(item.backup_file);

      // 2) DROP destructivo del destino
      await jobsRepo.updateItemStatus(item.id, 'dropping');
      await adapter.prepareTarget(item.target_db);

      // 3) Import + espera
      await jobsRepo.updateItemStatus(item.id, 'importing', { markStarted: true });
      const res = await adapter.restore(item);

      if (res.ok) {
        await jobsRepo.updateItemStatus(item.id, 'succeeded', { markFinished: true });
        await log('info', `✅ Restauración OK: ${item.target_db}`, { itemId: item.id });
      } else {
        allOk = false;
        const msg = describeGcpError(res.error) || JSON.stringify(res.error ?? {});
        firstError ??= `${item.target_db}: ${msg}`;
        await jobsRepo.updateItemStatus(item.id, 'failed', { errorMessage: msg, markFinished: true });
        await log('error', `❌ Restauración fallida: ${item.target_db} — ${msg}`, { itemId: item.id });
      }
    } catch (err) {
      allOk = false;
      const domain = err instanceof DomainError;
      // El motivo real (p.ej. el error de la operación de Cloud SQL) va en `cause`.
      const reason = describeGcpError(err.cause);
      const message = reason ? `${err.message} — ${reason}` : err.message;
      firstError ??= `${item.target_db}: ${message}`;
      logger?.error({ err, jobId: job.id, itemId: item.id }, 'Item fallido');
      await jobsRepo.updateItemStatus(item.id, 'failed', {
        errorMessage: message,
        markFinished: true,
      });
      await log(domain ? 'warning' : 'error', `❌ ${item.target_db}: ${message}`, {
        itemId: item.id,
      });
    }
  }

  // 4) Post-scripts solo si TODO salió OK (igual que el script original)
  if (allOk && adapter.postScripts.length === 0) {
    await log('info', 'ℹ️ Sin post-scripts configurados para la instancia.');
  } else if (allOk) {
    try {
      await log('info', `ℹ️ Todas las restauraciones OK. Ejecutando ${adapter.postScripts.length} post-script(s)...`);
      await adapter.runPostScripts();
    } catch (err) {
      allOk = false;
      firstError ??= `Post-scripts: ${err.message}`;
      await log('error', `❌ Post-scripts fallaron: ${err.message}`);
    }
  } else {
    await log('warning', '⚠️ No se ejecutan post-scripts: hubo restauraciones fallidas.');
  }

  await jobsRepo.finishJob(job.id, allOk ? 'succeeded' : 'failed', allOk ? null : (firstError ?? 'Ver eventos del job'));
  await log('info', '=== 🏁 Proceso completado ===');
}
