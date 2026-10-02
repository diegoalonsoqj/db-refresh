// Repositorio de post-scripts SQL por instancia. Queries parametrizadas.
import { query } from '../pool.js';

const COLS = `id, instance_ref, name, database_name, sql_text, sort_order, is_active,
              created_at, updated_at`;

export async function listForInstance(instanceId, { onlyActive = false } = {}) {
  const { rows } = await query(
    `SELECT ${COLS} FROM instance_post_scripts
      WHERE instance_ref = $1 ${onlyActive ? 'AND is_active' : ''}
      ORDER BY sort_order, name`,
    [instanceId],
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
       (instance_ref, name, database_name, sql_text, sort_order, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLS}`,
    [instanceId, s.name, s.databaseName, s.sqlText, s.sortOrder, s.isActive],
  );
  return rows[0];
}

export async function update(id, s) {
  const { rows } = await query(
    `UPDATE instance_post_scripts
        SET name = $2, database_name = $3, sql_text = $4, sort_order = $5,
            is_active = $6, updated_at = now()
      WHERE id = $1
      RETURNING ${COLS}`,
    [id, s.name, s.databaseName, s.sqlText, s.sortOrder, s.isActive],
  );
  return rows[0] ?? null;
}

export async function remove(id) {
  const { rowCount } = await query(`DELETE FROM instance_post_scripts WHERE id = $1`, [id]);
  return rowCount > 0;
}
