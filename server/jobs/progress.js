// Bus de progreso en memoria para SSE. El worker persiste el evento en job_events
// (fuente de verdad) y publica aquí para notificar a las conexiones SSE vivas.
// Nota: en despliegue multi-instancia, los clientes SSE que caigan en otra
// instancia recuperan el historial vía getEventsSince() con Last-Event-ID.
import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
bus.setMaxListeners(0); // sin límite de listeners (una conexión SSE por cliente)

function channel(jobId) {
  return `job:${jobId}`;
}

/** Publica un evento ya persistido para un job. */
export function publish(jobId, event) {
  bus.emit(channel(jobId), event);
}

/** Suscribe un handler a los eventos de un job. Devuelve función de desuscripción. */
export function subscribe(jobId, handler) {
  const ch = channel(jobId);
  bus.on(ch, handler);
  return () => bus.off(ch, handler);
}
