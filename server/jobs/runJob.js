// Ejecuta un job de restauración completo. Orquesta el adaptador de motor,
// persiste estado/eventos y publica progreso. Reproduce el flujo de
// restore_to_csql.py: validar -> drop -> import (por item) -> post-scripts.
import * as jobsRepo from '../data/repositories/jobs.repo.js';
import * as catalogRepo from '../data/repositories/catalog.repo.js';
import { createAdapter } from '../engines/index.js';
import { publish } from './progress.js';
import { DomainError } from '../domain/errors.js';

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

  let allOk = true;

  for (const item of items) {
    try {
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
        const msg = JSON.stringify(res.error ?? {});
        await jobsRepo.updateItemStatus(item.id, 'failed', { errorMessage: msg, markFinished: true });
        await log('error', `❌ Restauración fallida: ${item.target_db} — ${msg}`, { itemId: item.id });
      }
    } catch (err) {
      allOk = false;
      const domain = err instanceof DomainError;
      await jobsRepo.updateItemStatus(item.id, 'failed', {
        errorMessage: err.message,
        markFinished: true,
      });
      await log(domain ? 'warning' : 'error', `❌ ${item.target_db}: ${err.message}`, {
        itemId: item.id,
      });
    }
  }

  // 4) Post-scripts solo si TODO salió OK (igual que el script original)
  if (allOk) {
    try {
      await log('info', 'ℹ️ Todas las restauraciones OK. Ejecutando post-scripts...');
      await adapter.runPostScripts();
    } catch (err) {
      allOk = false;
      await log('error', `❌ Post-scripts fallaron: ${err.message}`);
    }
  } else {
    await log('warning', '⚠️ No se ejecutan post-scripts: hubo restauraciones fallidas.');
  }

  await jobsRepo.finishJob(job.id, allOk ? 'succeeded' : 'failed', allOk ? null : 'Ver eventos del job');
  await log('info', '=== 🏁 Proceso completado ===');
}
