// Helper de auditoría (fire-and-forget): nunca rompe el request si falla.
// NO registra bodies (pueden contener secretos), solo actor/acción/ip/metadata.
import { insertAudit } from '../data/repositories/audit.repo.js';
import { logger } from './logger.js';

export function audit({ req, actor, action, entity, metadata } = {}) {
  // inet inválida u otros fallos no deben afectar el flujo.
  let ip = req?.ip ?? null;
  if (ip && !/^[0-9a-fA-F:.]+$/.test(ip)) ip = null;

  insertAudit({
    actor: actor ?? req?.user?.id ?? null,
    action,
    entity: entity ?? null,
    metadata: metadata ?? null,
    ip,
  }).catch((err) => logger.warn({ err, action }, 'No se pudo escribir auditoría'));
}
