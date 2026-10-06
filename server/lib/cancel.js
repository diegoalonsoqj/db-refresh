// Cancelación cooperativa de jobs: la API marca la petición en la BD y el worker
// la convierte en un AbortSignal que consultan las esperas largas (polling de
// operaciones de Cloud SQL, instancia ocupada) y los procesos nativos.
import { JobCancelledError } from '../domain/errors.js';

/** Espera `ms`; termina antes (sin error) si se aborta `signal`. */
export function sleep(ms, signal = null) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** Lanza JobCancelledError si se pidió cancelar. */
export function throwIfCancelled(signal) {
  if (signal?.aborted) throw new JobCancelledError();
}

/**
 * Vigila la petición de cancelación de un job consultando `isRequested()` cada
 * `intervalMs`. Devuelve { signal, stop }; `stop()` libera el temporizador.
 */
export function watchCancel(isRequested, { intervalMs = 5000, onError = null } = {}) {
  const controller = new AbortController();
  let busy = false;
  const timer = setInterval(async () => {
    if (busy || controller.signal.aborted) return;
    busy = true;
    try {
      if (await isRequested()) controller.abort();
    } catch (err) {
      onError?.(err); // fallo puntual de la BD: se reintenta en el siguiente ciclo
    } finally {
      busy = false;
    }
  }, intervalMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    stop: () => clearInterval(timer),
    abort: () => controller.abort(),
  };
}
