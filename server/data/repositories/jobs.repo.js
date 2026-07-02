// Repositorio de jobs de restauración: jobs, items y eventos.
// El worker consume estos jobs con FOR UPDATE SKIP LOCKED.
import { query, withTransaction } from '../pool.js';

/**
 * Crea un job y sus items en una sola transacción.
 * @param {object} job  { instanceId, bucketId, engine, requestedBy, bucketPath }
 * @param {Array}  items [{ backupFile, targetDb, seq, sizeBytes }]
 * @returns job creado con sus items
 */
export async function createJob(job, items) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO restore_jobs
         (instance_ref, bucket_ref, engine, requested_by, bucket_path, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING *`,
      [job.instanceId, job.bucketId ?? null, job.engine, job.requestedBy ?? null, job.bucketPath],
    );
    const created = rows[0];

    const insertedItems = [];
    for (const it of items) {
      const r = await client.query(
        `INSERT INTO restore_job_items
           (job_ref, backup_file, target_db, seq, size_bytes, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         RETURNING *`,
        [created.id, it.backupFile, it.targetDb, it.seq, it.sizeBytes ?? null],
      );
      insertedItems.push(r.rows[0]);
    }
    return { ...created, items: insertedItems };
  });
}

/**
 * Toma el siguiente job pendiente y lo marca 'running' de forma atómica.
 * SKIP LOCKED permite varios workers sin colisionar. Devuelve null si no hay.
 */
export async function claimNextJob(workerId) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id FROM restore_jobs
        WHERE status = 'pending'
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1`,
    );
    if (rows.length === 0) return null;

    const jobId = rows[0].id;
    const { rows: updated } = await client.query(
      `UPDATE restore_jobs
          SET status = 'running', started_at = now(),
              locked_at = now(), locked_by = $2
        WHERE id = $1
        RETURNING *`,
      [jobId, workerId],
    );
    return updated[0];
  });
}

/** Lista los jobs recientes (para el historial), con instancia/proyecto. */
export async function listJobs({ limit = 50 } = {}) {
  const { rows } = await query(
    `SELECT j.id, j.engine, j.status, j.bucket_path, j.error_message,
            j.created_at, j.started_at, j.finished_at,
            i.instance_name, p.project_id
       FROM restore_jobs j
       JOIN gcp_instances i ON i.id = j.instance_ref
       JOIN gcp_projects  p ON p.id = i.project_ref
      ORDER BY j.created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function getJobItems(jobId) {
  const { rows } = await query(
    `SELECT * FROM restore_job_items WHERE job_ref = $1 ORDER BY seq`,
    [jobId],
  );
  return rows;
}

export async function getJobWithItems(jobId) {
  const { rows } = await query(`SELECT * FROM restore_jobs WHERE id = $1`, [jobId]);
  if (rows.length === 0) return null;
  const items = await getJobItems(jobId);
  return { ...rows[0], items };
}

export async function finishJob(jobId, status, errorMessage = null) {
  await query(
    `UPDATE restore_jobs
        SET status = $2, error_message = $3, finished_at = now(),
            locked_at = NULL, locked_by = NULL
      WHERE id = $1`,
    [jobId, status, errorMessage],
  );
}

export async function updateItemStatus(itemId, status, patch = {}) {
  await query(
    `UPDATE restore_job_items
        SET status        = $2,
            gcp_operation = COALESCE($3, gcp_operation),
            error_message = COALESCE($4, error_message),
            started_at    = CASE WHEN started_at  IS NULL AND $5 THEN now() ELSE started_at  END,
            finished_at   = CASE WHEN $6 THEN now() ELSE finished_at END
      WHERE id = $1`,
    [
      itemId,
      status,
      patch.gcpOperation ?? null,
      patch.errorMessage ?? null,
      patch.markStarted ?? false,
      patch.markFinished ?? false,
    ],
  );
}

/** Registra un evento de progreso (feed SSE + traza). */
export async function addEvent(jobId, { itemId = null, level = 'info', message }) {
  const { rows } = await query(
    `INSERT INTO job_events (job_ref, item_ref, level, message)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [jobId, itemId, level, message],
  );
  return rows[0];
}

export async function getEventsSince(jobId, sinceId = 0) {
  const { rows } = await query(
    `SELECT * FROM job_events
      WHERE job_ref = $1 AND id > $2
      ORDER BY id`,
    [jobId, sinceId],
  );
  return rows;
}
