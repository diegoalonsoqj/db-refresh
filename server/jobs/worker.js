// Worker de jobs: proceso independiente que consume restore_jobs con
// FOR UPDATE SKIP LOCKED. Ejecuta hasta WORKER_CONCURRENCY jobs a la vez: los de
// instancias distintas en paralelo y los de una misma instancia en orden (lo
// garantiza claimNextJob). La mayor parte del tiempo un job solo espera a
// Cloud SQL, así que varios en paralelo apenas consumen recursos.
// Arranque: `npm run worker`. Pensado como UN proceso (PM2 instances: 1).
import { config } from '../config/index.js';
import { childLogger } from '../lib/logger.js';
import { addEvent, claimNextJob, failInterruptedJobs, finishJob } from '../data/repositories/jobs.repo.js';
import { closePool } from '../data/pool.js';
import { runJob } from './runJob.js';

const log = childLogger({ component: 'worker', workerId: config.worker.id });
const concurrency = config.worker.concurrency;

let running = true;
const active = new Set(); // promesas de los jobs en ejecución

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Ejecuta un job; un error inesperado (no del restore en sí) no lo deja colgado 'running'. */
async function execute(job) {
  log.info({ jobId: job.id, active: active.size }, 'Job tomado');
  try {
    await runJob(job, log);
  } catch (err) {
    log.error({ err, jobId: job.id }, 'Error inesperado ejecutando el job');
    await addEvent(job.id, { level: 'error', message: `Error interno del worker: ${err.message}` }).catch(() => {});
    await finishJob(job.id, 'failed', `Error interno del worker: ${err.message}`).catch(() => {});
  }
}

async function loop() {
  while (running) {
    if (active.size >= concurrency) {
      await Promise.race(active); // espera a que termine alguno
      continue;
    }
    let job = null;
    try {
      job = await claimNextJob(config.worker.id);
    } catch (err) {
      log.error({ err }, 'Error tomando el siguiente job');
    }
    if (!job) {
      await sleep(config.worker.pollIntervalMs);
      continue;
    }
    const p = execute(job).finally(() => active.delete(p));
    active.add(p);
  }
}

async function shutdown(signal) {
  log.info({ signal, active: active.size }, 'Apagando worker; esperando a que terminen los jobs en curso...');
  running = false;
  // deja terminar los jobs activos antes de cerrar el pool
  await Promise.allSettled([...active]);
  await closePool();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Jobs que quedaron 'running' de una ejecución anterior: marcarlos fallidos para
// que no bloqueen su instancia (la cola es por instancia).
const MSG = 'Interrumpido: el worker se detuvo o reinició mientras se ejecutaba. Revisa en Cloud SQL ' +
  '(operaciones de la instancia) si el import llegó a terminar antes de relanzarlo.';
try {
  const interrupted = await failInterruptedJobs(MSG);
  for (const { id } of interrupted) await addEvent(id, { level: 'error', message: MSG }).catch(() => {});
  if (interrupted.length) log.warn({ jobs: interrupted.map((j) => j.id) }, 'Jobs interrumpidos marcados como fallidos');
} catch (err) {
  log.error({ err }, 'No se pudieron revisar los jobs interrumpidos');
}

log.info({ concurrency }, 'Worker iniciado');
loop();
