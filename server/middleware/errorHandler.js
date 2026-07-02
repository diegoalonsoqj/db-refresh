// Middleware central de errores: mapea errores de dominio/infra a HTTP.
import { isAppError } from '../domain/errors.js';
import { logger } from '../lib/logger.js';

// eslint-disable-next-line no-unused-vars -- Express requiere 4 args
export function errorHandler(err, req, res, _next) {
  if (isAppError(err)) {
    const status = err.status ?? 500;
    if (status >= 500) logger.error({ err }, 'Error de infraestructura');
    else logger.warn({ err: err.message, code: err.code }, 'Error de dominio');
    return res.status(status).json({
      error: err.message,
      code: err.code,
      details: err.details,
    });
  }
  // Errores con status HTTP conocido (p.ej. body-parser PayloadTooLargeError 413).
  const httpStatus = err.status ?? err.statusCode;
  if (typeof httpStatus === 'number' && httpStatus >= 400 && httpStatus < 500) {
    logger.warn({ err: err.message, type: err.type }, 'Error de request');
    return res.status(httpStatus).json({ error: err.message, code: err.code ?? err.type ?? 'REQUEST_ERROR' });
  }
  logger.error({ err }, 'Error no controlado');
  return res.status(500).json({ error: 'Error interno', code: 'INTERNAL' });
}
