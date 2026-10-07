// Repositorio de tareas de restore (scheduled_restores) y su programación.
// mapping se guarda como jsonb: [{ source, backupFile|pattern, targetDb, ... }].
import { query } from '../pool.js';

const COLS = `s.id, s.name, s.instance_ref, s.bucket_ref, s.bucket_path, s.method, s.mapping, s.skip_sql_on_failure,
              s.schedule_mode, s.cron_expr, s.run_at, s.timezone, s.is_active,
              s.created_by, s.last_run_at, s.next_run_at, s.last_job_ref, s.last_error, s.created_at`;

// Para la lista: nombres de instancia/bucket y estado del último job.
const LIST_SQL = `
  SELECT ${COLS},
         i.instance_name, i.engine, p.project_id, b.bucket_name, b.base_prefix,
         j.status AS last_job_status
    FROM scheduled_restores s
    JOIN gcp_instances i ON i.id = s.instance_ref
    JOIN gcp_projects  p ON p.id = i.project_ref
    JOIN gcp_buckets   b ON b.id = s.bucket_ref
    LEFT JOIN restore_jobs j ON j.id = s.last_job_ref`;

export async function listSchedules() {
  const { rows } = await query(`${LIST_SQL} ORDER BY s.name, s.created_at`);
  return rows;
}

export async function getById(id) {
  const { rows } = await query(`${LIST_SQL} WHERE s.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function createSchedule(t) {
  const { rows } = await query(
    `INSERT INTO scheduled_restores
       (name, instance_ref, bucket_ref, bucket_path, method, mapping, skip_sql_on_failure, created_by,
        schedule_mode, is_active, timezone)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'none', false, $9)
     RETURNING id`,
    [t.name, t.instanceRef, t.bucketRef, t.bucketPath, t.method, JSON.stringify(t.mapping), t.skipSqlOnFailure,
      t.createdBy ?? null, t.timezone],
  );
  return getById(rows[0].id);
}

/** Edita la definición de la tarea (no toca su programación). */
export async function updateSchedule(id, t) {
  await query(
    `UPDATE scheduled_restores
        SET name = $2, instance_ref = $3, bucket_ref = $4, bucket_path = $5, method = $6,
            mapping = $7::jsonb, skip_sql_on_failure = $8
      WHERE id = $1`,
    [id, t.name, t.instanceRef, t.bucketRef, t.bucketPath, t.method, JSON.stringify(t.mapping), t.skipSqlOnFailure],
  );
  return getById(id);
}

/** Fija la programación (none | once | recurring) y su próxima ejecución. */
export async function setSchedule(id, s) {
  await query(
    `UPDATE scheduled_restores
        SET schedule_mode = $2, cron_expr = $3, run_at = $4, timezone = $5,
            next_run_at = $6, is_active = $7
      WHERE id = $1`,
    [id, s.mode, s.cronExpr, s.runAt, s.timezone, s.nextRunAt, s.isActive],
  );
  return getById(id);
}

export async function deleteSchedule(id) {
  const { rowCount } = await query(`DELETE FROM scheduled_restores WHERE id = $1`, [id]);
  return rowCount > 0;
}

/** Programaciones activas cuya próxima ejecución ya venció (las consume el scheduler). */
export async function findDue(now) {
  const { rows } = await query(
    `SELECT ${COLS} FROM scheduled_restores s
      WHERE s.is_active AND s.next_run_at IS NOT NULL AND s.next_run_at <= $1
      ORDER BY s.next_run_at`,
    [now],
  );
  return rows;
}

/** Activas sin próxima ejecución calculada (p.ej. migradas de la versión con node-cron). */
export async function findActiveWithoutNext() {
  const { rows } = await query(
    `SELECT ${COLS} FROM scheduled_restores s WHERE s.is_active AND s.next_run_at IS NULL`,
  );
  return rows;
}

export async function setNextRun(id, nextRunAt, isActive) {
  await query(`UPDATE scheduled_restores SET next_run_at = $2, is_active = $3 WHERE id = $1`, [id, nextRunAt, isActive]);
}

/**
 * Reserva el disparo de forma atómica: avanza next_run_at (o desactiva) solo si
 * sigue siendo el leído. Si otro proceso ya la tomó, no cambia nada y devuelve
 * false: así una programación no lanza dos restores.
 */
export async function claimRun(id, expectedNextRunAt, { lastRunAt, nextRunAt, isActive }) {
  const { rowCount } = await query(
    `UPDATE scheduled_restores
        SET last_run_at = $3, next_run_at = $4, is_active = $5
      WHERE id = $1 AND is_active AND next_run_at = $2`,
    [id, expectedNextRunAt, lastRunAt, nextRunAt, isActive],
  );
  return rowCount === 1;
}

/** Resultado de un disparo: el job encolado o el error que lo impidió. */
export async function recordRun(id, { lastRunAt, jobId = null, error = null }) {
  await query(
    `UPDATE scheduled_restores
        SET last_run_at = $2, last_job_ref = COALESCE($3, last_job_ref), last_error = $4
      WHERE id = $1`,
    [id, lastRunAt, jobId, error],
  );
}
