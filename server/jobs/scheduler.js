// Scheduler in-app: proceso independiente que dispara las tareas de restore
// programadas y las encola como restore_jobs (el worker es el único que las
// ejecuta). Arranque: `npm run scheduler`.
//
// Modelo de db-keeper: cada SCHEDULER_POLL_INTERVAL_MS busca las programaciones
// activas con next_run_at vencido, reserva cada disparo de forma atómica
// (claimRun: avanza next_run_at solo si nadie lo hizo antes, así no se lanza dos
// veces) y luego encola el restore. Una "una vez" se desactiva al dispararse;
// una recurrente calcula su siguiente ejecución con cron-parser en su zona horaria.
import { config } from '../config/index.js';
import { childLogger } from '../lib/logger.js';
import * as repo from '../data/repositories/schedules.repo.js';
import { triggerSchedule } from '../services/schedule.service.js';
import { afterRun } from '../domain/restoreTask.js';
import { closePool } from '../data/pool.js';

const log = childLogger({ component: 'scheduler' });
let running = true;

/** Activas sin próxima ejecución (p.ej. migradas de la versión anterior): se calcula. */
async function repairNextRuns(now) {
  for (const task of await repo.findActiveWithoutNext()) {
    const { nextRunAt, isActive } = afterRun(task, now);
    await repo.setNextRun(task.id, nextRunAt, isActive);
    log.info({ id: task.id, nextRunAt, isActive }, 'Próxima ejecución calculada');
  }
}

async function tick() {
  const now = new Date();
  await repairNextRuns(now);
  for (const task of await repo.findDue(now)) {
    const next = afterRun(task, now);
    const claimed = await repo.claimRun(task.id, task.next_run_at, { lastRunAt: now, ...next });
    if (!claimed) continue; // otro proceso ya la disparó
    try {
      const job = await triggerSchedule(task, now);
      log.info({ id: task.id, name: task.name, jobId: job.id }, 'Tarea disparada: job encolado');
    } catch (err) {
      // triggerSchedule ya dejó el motivo en la tarea (last_error) para la UI.
      log.error({ id: task.id, name: task.name, err }, 'No se pudo disparar la tarea');
    }
  }
}

async function loop() {
  while (running) {
    try {
      await tick();
    } catch (err) {
      log.error({ err }, 'Fallo en el ciclo del scheduler');
    }
    await new Promise((r) => setTimeout(r, config.scheduler.pollIntervalMs));
  }
}

async function shutdown(signal) {
  log.info({ signal }, 'Apagando scheduler...');
  running = false;
  await closePool();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

log.info({ pollMs: config.scheduler.pollIntervalMs, timezone: config.scheduler.timezone }, 'Scheduler iniciado');
loop();
