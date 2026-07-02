// Worker de jobs: proceso independiente que consume restore_jobs con
// FOR UPDATE SKIP LOCKED. Se puede escalar a N workers sin colisión.
// Arranque: `npm run worker`.
import { config } from '../config/index.js';
import { childLogger } from '../lib/logger.js';
import { claimNextJob } from '../data/repositories/jobs.repo.js';
import { closePool } from '../data/pool.js';
import { runJob } from './runJob.js';

const log = childLogger({ component: 'worker', workerId: config.worker.id });

let running = true;
let active = false;

async function loop() {
  while (running) {
    try {
      const job = await claimNextJob(config.worker.id);
      if (!job) {
        await sleep(config.worker.pollIntervalMs);
        continue;
      }
      active = true;
      log.info({ jobId: job.id }, 'Job tomado');
      await runJob(job, log);
      active = false;
    } catch (err) {
      active = false;
      log.error({ err }, 'Error en el loop del worker');
      await sleep(config.worker.pollIntervalMs);
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function shutdown(signal) {
  log.info({ signal }, 'Apagando worker; esperando a que termine el job en curso...');
  running = false;
  // deja terminar el job activo antes de cerrar el pool
  while (active) await sleep(500);
  await closePool();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

log.info('Worker iniciado');
loop();
