// Scheduler in-app: proceso independiente que programa las restauraciones de
// scheduled_restores con node-cron y las encola como restore_jobs (el worker es
// el único que las ejecuta). Reemplaza el crontab del SO. Arranque: `npm run scheduler`.
//
// Reconciliación: cada RECONCILE_MS relee las schedules activas y sincroniza las
// tareas cron en memoria (alta/baja/cambio de cron o de estado). Al dispararse,
// re-lee la fila fresca de la BD para usar mapping/bucket actualizados.
import cron from 'node-cron';
import { childLogger } from '../lib/logger.js';
import * as schedulesRepo from '../data/repositories/schedules.repo.js';
import { triggerSchedule } from '../services/schedule.service.js';
import { closePool } from '../data/pool.js';

const log = childLogger({ component: 'scheduler' });
const RECONCILE_MS = 30_000;

// id -> { signature, task }
const tasks = new Map();
let running = true;

const signatureOf = (s) => `${s.cron_expr}|${s.is_active}`;

async function fire(id) {
  try {
    const schedule = await schedulesRepo.getById(id);
    if (!schedule || !schedule.is_active) return;
    log.info({ id }, 'Disparando schedule');
    const job = await triggerSchedule(schedule);
    log.info({ id, jobId: job.id }, 'Job encolado por schedule');
  } catch (err) {
    log.error({ id, err }, 'Fallo al disparar schedule');
  }
}

async function reconcile() {
  let active;
  try {
    active = await schedulesRepo.listActive();
  } catch (err) {
    log.error({ err }, 'No se pudo leer schedules activas');
    return;
  }

  const seen = new Set();
  for (const s of active) {
    seen.add(s.id);
    const existing = tasks.get(s.id);
    const sig = signatureOf(s);
    if (existing && existing.signature === sig) continue; // sin cambios
    if (existing) existing.task.stop();
    if (!cron.validate(s.cron_expr)) {
      log.warn({ id: s.id, cron: s.cron_expr }, 'cron_expr inválida; se ignora');
      tasks.delete(s.id);
      continue;
    }
    const task = cron.schedule(s.cron_expr, () => fire(s.id));
    tasks.set(s.id, { signature: sig, task });
    log.info({ id: s.id, cron: s.cron_expr }, existing ? 'Schedule actualizado' : 'Schedule registrado');
  }

  // Baja de las que ya no están activas/presentes.
  for (const [id, entry] of tasks) {
    if (!seen.has(id)) {
      entry.task.stop();
      tasks.delete(id);
      log.info({ id }, 'Schedule removido');
    }
  }
}

async function loop() {
  await reconcile();
  while (running) {
    await new Promise((r) => setTimeout(r, RECONCILE_MS));
    if (running) await reconcile();
  }
}

async function shutdown(signal) {
  log.info({ signal }, 'Apagando scheduler...');
  running = false;
  for (const { task } of tasks.values()) task.stop();
  tasks.clear();
  await closePool();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

log.info('Scheduler iniciado');
loop();
