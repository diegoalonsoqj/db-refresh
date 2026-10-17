// Repositorio de auditoría (audit_log). Parametrizado.
import { query } from '../pool.js';
import { SqlWhere, orderBy, pagedQuery } from '../../lib/listQuery.js';

export async function insertAudit({ actor, action, entity, metadata, ip }) {
  await query(
    `INSERT INTO audit_log (actor, action, entity, metadata, ip_address)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [actor ?? null, action, entity ?? null, metadata ? JSON.stringify(metadata) : null, ip ?? null],
  );
}

const AUDIT_FROM = `audit_log a LEFT JOIN app_users u ON u.id = a.actor`;

const AUDIT_ORDER = {
  created: 'a.created_at',
  user: 'lower(COALESCE(u.email, u.username))',
  action: 'a.action',
  entity: 'a.entity',
  ip: 'a.ip_address',
};
export const AUDIT_SORTS = Object.keys(AUDIT_ORDER);

/** Auditoría paginada. Acción, entidad y usuario: coincidencia parcial; fechas: rango de días. */
export async function listAudit({ limit, offset, sort, dir, filters = {} }) {
  const where = new SqlWhere()
    .search(['a.action'], filters.action)
    .search(['a.entity'], filters.entity)
    .search(['u.email', 'u.username', 'u.full_name'], filters.user)
    .dateRange('a.created_at', filters.from, filters.to);
  return pagedQuery(query, {
    select: `SELECT a.id, a.actor, COALESCE(u.email, u.username) AS actor_email, a.action, a.entity,
                    a.metadata, a.ip_address, a.created_at
               FROM ${AUDIT_FROM}`,
    countFrom: AUDIT_FROM,
    where,
    order: orderBy(AUDIT_ORDER, sort, dir, { sort: 'created', dir: 'desc' }, 'a.id DESC'),
    limit,
    offset,
  });
}
