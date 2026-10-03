// Bus de progreso para SSE. El worker corre en OTRO proceso (PM2): persiste cada
// evento en job_events (fuente de verdad) y lo anuncia con NOTIFY (jobs.repo.addEvent).
// La API mantiene una conexión dedicada con LISTEN y reemite los eventos en este
// bus local, al que se suscriben las conexiones SSE vivas.
// Los duplicados (p.ej. si worker y API comparten proceso) se descartan en el SSE
// por id (streamJob solo envía ids mayores que el último enviado).
import { EventEmitter } from 'node:events';
import pg from 'pg';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { EVENTS_CHANNEL, getEventById } from '../data/repositories/jobs.repo.js';

const bus = new EventEmitter();
bus.setMaxListeners(0); // sin límite de listeners (una conexión SSE por cliente)

function channel(jobId) {
  return `job:${jobId}`;
}

/** Publica un evento ya persistido para un job (mismo proceso). */
export function publish(jobId, event) {
  bus.emit(channel(jobId), event);
}

/** Suscribe un handler a los eventos de un job. Devuelve función de desuscripción. */
export function subscribe(jobId, handler) {
  startListener();
  const ch = channel(jobId);
  bus.on(ch, handler);
  return () => bus.off(ch, handler);
}

/** "jobId:eventId" -> { jobId, eventId } (función pura). */
export function parseNotification(payload) {
  const m = /^([0-9a-f-]{36}):(\d+)$/i.exec(String(payload ?? ''));
  return m ? { jobId: m[1], eventId: Number(m[2]) } : null;
}

// --- LISTEN (solo se arranca en el proceso que tiene suscriptores SSE: la API) ---
let listener = null;
let starting = false;
let retryMs = 1000;

async function onNotification(msg) {
  const parsed = parseNotification(msg.payload);
  if (!parsed || bus.listenerCount(channel(parsed.jobId)) === 0) return; // nadie mirando ese job
  try {
    const event = await getEventById(parsed.eventId);
    if (event) bus.emit(channel(parsed.jobId), event);
  } catch (err) {
    logger.warn({ err: err.message }, 'No se pudo leer el evento notificado');
  }
}

function startListener() {
  if (listener || starting) return;
  starting = true;
  const client = new pg.Client({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
    application_name: 'db-refresh-sse',
  });
  let failed = false; // 'error' y el catch de connect pueden llegar ambos: reintentar una vez
  const retry = (err) => {
    if (failed) return;
    failed = true;
    if (err) logger.warn({ err: err.message }, `LISTEN ${EVENTS_CHANNEL} caído; reintentando`);
    listener = null;
    starting = false;
    client.removeAllListeners();
    client.end().catch(() => {});
    setTimeout(startListener, retryMs).unref();
    retryMs = Math.min(retryMs * 2, 30_000);
  };
  client.on('notification', onNotification);
  client.on('error', retry);
  client
    .connect()
    .then(() => client.query(`LISTEN ${EVENTS_CHANNEL}`))
    .then(() => {
      listener = client;
      starting = false;
      retryMs = 1000;
      logger.info(`Escuchando eventos de jobs (LISTEN ${EVENTS_CHANNEL})`);
    })
    .catch(retry);
}

/** Cierra la conexión LISTEN (apagado de la API / tests). */
export async function stopListener() {
  const client = listener;
  listener = null;
  if (client) await client.end().catch(() => {});
}
