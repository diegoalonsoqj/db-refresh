// Repositorio de restauraciones programadas (scheduled_restores).
// mapping se guarda como jsonb: [{ backupFile, targetDb }, ...].
import { query } from '../pool.js';

const COLS = `id, instance_ref, bucket_ref, cron_expr, mapping, is_active,
              created_by, last_run_at, next_run_at, created_at`;

export async function listSchedules() {
  const { rows } = await query(`SELECT ${COLS} FROM scheduled_restores ORDER BY created_at DESC`);
  return rows;
}

/** Solo las activas (las consume el proceso scheduler). */
export async function listActive() {
  const { rows } = await query(
    `SELECT ${COLS} FROM scheduled_restores WHERE is_active ORDER BY created_at`,
  );
  return rows;
}

export async function getById(id) {
  const { rows } = await query(`SELECT ${COLS} FROM scheduled_restores WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function createSchedule(s) {
  const { rows } = await query(
    `INSERT INTO scheduled_restores
       (instance_ref, bucket_ref, cron_expr, mapping, is_active, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     RETURNING ${COLS}`,
    [s.instanceRef, s.bucketRef, s.cronExpr, JSON.stringify(s.mapping), s.isActive ?? true, s.createdBy ?? null],
  );
  return rows[0];
}

export async function updateSchedule(id, s) {
  const { rows } = await query(
    `UPDATE scheduled_restores
        SET instance_ref = $2, bucket_ref = $3, cron_expr = $4,
            mapping = $5::jsonb, is_active = $6
      WHERE id = $1
      RETURNING ${COLS}`,
    [id, s.instanceRef, s.bucketRef, s.cronExpr, JSON.stringify(s.mapping), s.isActive ?? true],
  );
  return rows[0] ?? null;
}

export async function deleteSchedule(id) {
  const { rowCount } = await query(`DELETE FROM scheduled_restores WHERE id = $1`, [id]);
  return rowCount > 0;
}

/** Marca la última ejecución (y opcionalmente la próxima). */
export async function markRun(id, lastRunAt, nextRunAt = null) {
  await query(
    `UPDATE scheduled_restores SET last_run_at = $2, next_run_at = $3 WHERE id = $1`,
    [id, lastRunAt, nextRunAt],
  );
}
