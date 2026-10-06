// Repositorio de jobs de restauración: jobs, items y eventos.
// El worker consume estos jobs con FOR UPDATE SKIP LOCKED.
import { query, withTransaction } from '../pool.js';

/**
 * Crea un job y sus items en una sola transacción.
 * @param {object} job  { instanceId, bucketId, engine, requestedBy, bucketPath, method, skipSqlOnFailure }
 * @param {Array}  items [{ backupFile, targetDb, seq, sizeBytes, importUser, scope, schemaName, fixOrphans, dbOwner, dropViaSql }]
 * @returns job creado con sus items
 */
export async function createJob(job, items) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO restore_jobs
         (instance_ref, bucket_ref, engine, requested_by, bucket_path, method, skip_sql_on_failure, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       RETURNING *`,
      [job.instanceId, job.bucketId ?? null, job.engine, job.requestedBy ?? null, job.bucketPath,
        job.method ?? 'import', job.skipSqlOnFailure ?? false],
    );
    const created = rows[0];

    const insertedItems = [];
    for (const it of items) {
      const r = await client.query(
        `INSERT INTO restore_job_items
           (job_ref, backup_file, target_db, seq, size_bytes, import_user, scope, schema_name,
            fix_orphans, orphan_db_owner, drop_via_sql, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')
         RETURNING *`,
        [created.id, it.backupFile, it.targetDb, it.seq, it.sizeBytes ?? null, it.importUser ?? null,
          it.scope ?? 'database', it.schemaName ?? null, it.fixOrphans ?? false, it.dbOwner ?? null,
          it.dropViaSql ?? false],
      );
      insertedItems.push(r.rows[0]);
    }
    return { ...created, items: insertedItems };
  });
}

/**
 * Toma el siguiente job pendiente y lo marca 'running' de forma atómica.
 * Jobs de instancias distintas corren en paralelo; los de una misma instancia,
 * en orden (Cloud SQL admite una operación a la vez por instancia): se salta un
 * job si su instancia ya tiene otro en curso.
 *  - SKIP LOCKED: varios claims a la vez no toman el mismo job.
 *  - Bloqueo consultivo por instancia (hasta el COMMIT) + re-chequeo: dos claims
 *    simultáneos no pueden poner en curso dos jobs de la misma instancia.
 * Devuelve null si no hay nada que tomar.
 */
export async function claimNextJob(workerId) {
  return withTransaction(async (client) => {
    const { rows: candidates } = await client.query(
      `SELECT j.id, j.instance_ref
         FROM restore_jobs j
        WHERE j.status = 'pending'
          AND NOT EXISTS (SELECT 1 FROM restore_jobs r
                           WHERE r.instance_ref = j.instance_ref AND r.status = 'running')
        ORDER BY j.created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 20`,
    );
    for (const cand of candidates) {
      const { rows: [lock] } = await client.query(
        `SELECT pg_try_advisory_xact_lock(hashtextextended($1::text, 0)) AS ok`,
        [cand.instance_ref],
      );
      if (!lock.ok) continue; // otro claim está tomando un job de esta instancia
      // Sentencia nueva => ve lo confirmado por otros claims mientras tanto.
      const { rows: busy } = await client.query(
        `SELECT 1 FROM restore_jobs WHERE instance_ref = $1 AND status = 'running' LIMIT 1`,
        [cand.instance_ref],
      );
      if (busy.length) continue;
      const { rows: updated } = await client.query(
        `UPDATE restore_jobs
            SET status = 'running', started_at = now(),
                locked_at = now(), locked_by = $2
          WHERE id = $1
          RETURNING *`,
        [cand.id, workerId],
      );
      return updated[0];
    }
    return null;
  });
}

/**
 * Al arrancar el worker: los jobs que quedaron 'running' de una ejecución
 * anterior (el proceso murió o se reinició a mitad) se marcan fallidos, para
 * que no bloqueen su instancia. Supone un único proceso worker (PM2, instances: 1),
 * que es quien los ejecutaba. Devuelve los jobs afectados.
 */
export async function failInterruptedJobs(message) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE restore_jobs
          SET status = 'failed', error_message = $1, finished_at = now(), locked_at = NULL, locked_by = NULL
        WHERE status = 'running'
        RETURNING id`,
      [message],
    );
    if (rows.length) {
      await client.query(
        `UPDATE restore_job_items
            SET status = 'failed', error_message = COALESCE(error_message, $2), finished_at = COALESCE(finished_at, now())
          WHERE job_ref = ANY($1) AND status NOT IN ('succeeded', 'failed')`,
        [rows.map((r) => r.id), message],
      );
    }
    return rows;
  });
}

/**
 * Cancela un job que aún no ha empezado (pending -> cancelled, también sus items).
 * Atómico frente a claimNextJob: si el worker ya lo tomó, no cambia nada.
 * @returns el job cancelado o null si ya no estaba pendiente
 */
export async function cancelPendingJob(jobId, userId, message) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE restore_jobs
          SET status = 'cancelled', error_message = $3, finished_at = now(),
              cancel_requested_at = now(), cancel_requested_by = $2
        WHERE id = $1 AND status = 'pending'
        RETURNING *`,
      [jobId, userId ?? null, message],
    );
    if (!rows.length) return null;
    await client.query(
      `UPDATE restore_job_items SET status = 'cancelled', finished_at = now()
        WHERE job_ref = $1 AND status = 'pending'`,
      [jobId],
    );
    return rows[0];
  });
}

/**
 * Pide cancelar un job en curso: solo lo marca; el worker lo detecta y lo detiene.
 * @returns el job o null si no estaba en curso o ya se había pedido
 */
export async function requestCancel(jobId, userId) {
  const { rows } = await query(
    `UPDATE restore_jobs SET cancel_requested_at = now(), cancel_requested_by = $2
      WHERE id = $1 AND status = 'running' AND cancel_requested_at IS NULL
      RETURNING *`,
    [jobId, userId ?? null],
  );
  return rows[0] ?? null;
}

/** ¿Se pidió cancelar el job? (lo consulta el worker periódicamente). */
export async function isCancelRequested(jobId) {
  const { rows } = await query(`SELECT cancel_requested_at IS NOT NULL AS r FROM restore_jobs WHERE id = $1`, [jobId]);
  return rows[0]?.r === true;
}

/** Lista los jobs recientes (para el historial), con instancia/proyecto. */
export async function listJobs({ limit = 50 } = {}) {
  const { rows } = await query(
    `SELECT j.id, j.engine, j.status, j.bucket_path, j.error_message, j.warning_message, j.cancel_requested_at,
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

/** `warningMessage`: el job terminó bien pero se omitió algún paso ("OK con avisos"). */
export async function finishJob(jobId, status, errorMessage = null, warningMessage = null) {
  await query(
    `UPDATE restore_jobs
        SET status = $2, error_message = $3, warning_message = $4, finished_at = now(),
            locked_at = NULL, locked_by = NULL
      WHERE id = $1`,
    [jobId, status, errorMessage, warningMessage],
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
/** Canal de NOTIFY por el que el worker avisa a la API de cada evento nuevo (payload "jobId:eventId"). */
export const EVENTS_CHANNEL = 'job_events';

export async function addEvent(jobId, { itemId = null, level = 'info', message }) {
  // Insert + aviso en una sola sentencia: la API (otro proceso) lo recibe por LISTEN
  // y lo reenvía al navegador por SSE.
  const { rows } = await query(
    `WITH ev AS (
       INSERT INTO job_events (job_ref, item_ref, level, message)
       VALUES ($1, $2, $3, $4)
       RETURNING *
     )
     SELECT ev.*, pg_notify('${EVENTS_CHANNEL}', ev.job_ref::text || ':' || ev.id::text) AS _notified FROM ev`,
    [jobId, itemId, level, message],
  );
  const { _notified, ...event } = rows[0];
  return event;
}

export async function getEventById(id) {
  const { rows } = await query(`SELECT * FROM job_events WHERE id = $1`, [id]);
  return rows[0] ?? null;
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
