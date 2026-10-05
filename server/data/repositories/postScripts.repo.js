// Repositorio de scripts SQL por instancia (pre y post-restore). Queries parametrizadas.
import { query } from '../pool.js';

const COLS = `id, instance_ref, name, phase, database_name, sql_text, sort_order, is_active,
              created_at, updated_at`;

export async function listForInstance(instanceId, { onlyActive = false, phase = null } = {}) {
  const { rows } = await query(
    `SELECT ${COLS} FROM instance_post_scripts
      WHERE instance_ref = $1 ${onlyActive ? 'AND is_active' : ''} AND ($2::text IS NULL OR phase = $2)
      ORDER BY phase DESC, sort_order, name`,
    [instanceId, phase],
  );
  return rows;
}

export async function getById(id) {
  const { rows } = await query(`SELECT ${COLS} FROM instance_post_scripts WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function create(instanceId, s) {
  const { rows } = await query(
    `INSERT INTO instance_post_scripts
       (instance_ref, name, phase, database_name, sql_text, sort_order, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLS}`,
    [instanceId, s.name, s.phase, s.databaseName, s.sqlText, s.sortOrder, s.isActive],
  );
  return rows[0];
}

export async function update(id, s) {
  const { rows } = await query(
    `UPDATE instance_post_scripts
        SET name = $2, phase = $3, database_name = $4, sql_text = $5, sort_order = $6,
            is_active = $7, updated_at = now()
      WHERE id = $1
      RETURNING ${COLS}`,
    [id, s.name, s.phase, s.databaseName, s.sqlText, s.sortOrder, s.isActive],
  );
  return rows[0] ?? null;
}

export async function remove(id) {
  const { rowCount } = await query(`DELETE FROM instance_post_scripts WHERE id = $1`, [id]);
  return rowCount > 0;
}
