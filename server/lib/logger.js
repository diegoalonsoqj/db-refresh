// Logging estructurado. Un solo logger raíz; usar child() para contexto.
import pino from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
  level: config.logLevel,
  base: { service: 'db-refresh' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function childLogger(bindings) {
  return logger.child(bindings);
}
