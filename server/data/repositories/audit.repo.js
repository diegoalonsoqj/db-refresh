// Repositorio de auditoría (audit_log). Parametrizado.
import { query } from '../pool.js';

export async function insertAudit({ actor, action, entity, metadata, ip }) {
  await query(
    `INSERT INTO audit_log (actor, action, entity, metadata, ip_address)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [actor ?? null, action, entity ?? null, metadata ? JSON.stringify(metadata) : null, ip ?? null],
  );
}

export async function listAudit({ limit = 100 } = {}) {
  const { rows } = await query(
    `SELECT a.id, a.actor, u.email AS actor_email, a.action, a.entity,
            a.metadata, a.ip_address, a.created_at
       FROM audit_log a
       LEFT JOIN app_users u ON u.id = a.actor
      ORDER BY a.id DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}
