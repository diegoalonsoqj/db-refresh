// Repositorio de catálogo GCP (proyectos, instancias, buckets, N:N).
// Todas las queries parametrizadas. Los repos no validan reglas de negocio
// (eso es del servicio); solo acceso a datos.
import { query, withTransaction } from '../pool.js';

// --- Proyectos -------------------------------------------------------------
export async function listProjects() {
  const { rows } = await query(
    `SELECT id, project_id, description, created_at FROM gcp_projects ORDER BY project_id`,
  );
  return rows;
}

export async function getProjectById(id) {
  const { rows } = await query(
    `SELECT id, project_id, description, created_at FROM gcp_projects WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function createProject({ projectId, description }) {
  const { rows } = await query(
    `INSERT INTO gcp_projects (project_id, description) VALUES ($1, $2) RETURNING *`,
    [projectId, description ?? null],
  );
  return rows[0];
}

export async function updateProject(id, { projectId, description }) {
  const { rows } = await query(
    `UPDATE gcp_projects SET project_id = $2, description = $3 WHERE id = $1 RETURNING *`,
    [id, projectId, description ?? null],
  );
  return rows[0] ?? null;
}

export async function deleteProject(id) {
  const { rowCount } = await query(`DELETE FROM gcp_projects WHERE id = $1`, [id]);
  return rowCount > 0;
}

// --- Instancias ------------------------------------------------------------
export async function getInstanceById(id) {
  const { rows } = await query(
    `SELECT i.id, i.project_ref, i.instance_name, i.engine, i.db_host, i.db_port,
            i.admin_user, i.secret_ref, i.is_active, i.created_at,
            p.project_id
       FROM gcp_instances i
       JOIN gcp_projects p ON p.id = i.project_ref
      WHERE i.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function listInstances() {
  const { rows } = await query(
    `SELECT i.id, i.project_ref, i.instance_name, i.engine, i.db_host, i.db_port,
            i.admin_user, i.secret_ref, i.is_active, i.created_at, p.project_id
       FROM gcp_instances i
       JOIN gcp_projects p ON p.id = i.project_ref
      ORDER BY p.project_id, i.instance_name`,
  );
  return rows;
}

export async function createInstance(inst) {
  const { rows } = await query(
    `INSERT INTO gcp_instances
       (project_ref, instance_name, engine, db_host, db_port, admin_user, secret_ref, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      inst.projectRef, inst.instanceName, inst.engine, inst.dbHost,
      inst.dbPort ?? null, inst.adminUser, inst.secretRef, inst.isActive ?? true,
    ],
  );
  return rows[0];
}

export async function updateInstance(id, inst) {
  const { rows } = await query(
    `UPDATE gcp_instances
        SET project_ref = $2, instance_name = $3, engine = $4, db_host = $5,
            db_port = $6, admin_user = $7, secret_ref = $8, is_active = $9
      WHERE id = $1
      RETURNING *`,
    [
      id, inst.projectRef, inst.instanceName, inst.engine, inst.dbHost,
      inst.dbPort ?? null, inst.adminUser, inst.secretRef, inst.isActive ?? true,
    ],
  );
  return rows[0] ?? null;
}

export async function deleteInstance(id) {
  const { rowCount } = await query(`DELETE FROM gcp_instances WHERE id = $1`, [id]);
  return rowCount > 0;
}

// --- Buckets ---------------------------------------------------------------
export async function getBucketById(id) {
  const { rows } = await query(
    `SELECT b.id, b.project_ref, b.bucket_name, b.base_prefix, b.description,
            b.is_active, b.created_at, p.project_id
       FROM gcp_buckets b
       JOIN gcp_projects p ON p.id = b.project_ref
      WHERE b.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function listBuckets() {
  const { rows } = await query(
    `SELECT b.id, b.project_ref, b.bucket_name, b.base_prefix, b.description,
            b.is_active, b.created_at, p.project_id
       FROM gcp_buckets b
       JOIN gcp_projects p ON p.id = b.project_ref
      ORDER BY p.project_id, b.bucket_name`,
  );
  return rows;
}

export async function createBucket(bucket) {
  const { rows } = await query(
    `INSERT INTO gcp_buckets (project_ref, bucket_name, base_prefix, description, is_active)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [bucket.projectRef, bucket.bucketName, bucket.basePrefix ?? null, bucket.description ?? null, bucket.isActive ?? true],
  );
  return rows[0];
}

export async function updateBucket(id, bucket) {
  const { rows } = await query(
    `UPDATE gcp_buckets
        SET project_ref = $2, bucket_name = $3, base_prefix = $4,
            description = $5, is_active = $6
      WHERE id = $1
      RETURNING *`,
    [id, bucket.projectRef, bucket.bucketName, bucket.basePrefix ?? null, bucket.description ?? null, bucket.isActive ?? true],
  );
  return rows[0] ?? null;
}

export async function deleteBucket(id) {
  const { rowCount } = await query(`DELETE FROM gcp_buckets WHERE id = $1`, [id]);
  return rowCount > 0;
}

// --- Relación N:N instancia <-> bucket -------------------------------------
export async function listBucketsForInstance(instanceId) {
  const { rows } = await query(
    `SELECT b.id, b.bucket_name, b.base_prefix, b.description, b.is_active,
            ib.is_default, p.project_id
       FROM instance_buckets ib
       JOIN gcp_buckets b ON b.id = ib.bucket_ref
       JOIN gcp_projects p ON p.id = b.project_ref
      WHERE ib.instance_ref = $1
      ORDER BY ib.is_default DESC, b.bucket_name`,
    [instanceId],
  );
  return rows;
}

/** Vincula (o actualiza) un bucket a una instancia. Si isDefault, desmarca los demás. */
export async function linkInstanceBucket(instanceId, bucketId, isDefault = false) {
  return withTransaction(async (client) => {
    if (isDefault) {
      await client.query(
        `UPDATE instance_buckets SET is_default = false WHERE instance_ref = $1`,
        [instanceId],
      );
    }
    const { rows } = await client.query(
      `INSERT INTO instance_buckets (instance_ref, bucket_ref, is_default)
       VALUES ($1, $2, $3)
       ON CONFLICT (instance_ref, bucket_ref) DO UPDATE SET is_default = EXCLUDED.is_default
       RETURNING *`,
      [instanceId, bucketId, isDefault],
    );
    return rows[0];
  });
}

export async function unlinkInstanceBucket(instanceId, bucketId) {
  const { rowCount } = await query(
    `DELETE FROM instance_buckets WHERE instance_ref = $1 AND bucket_ref = $2`,
    [instanceId, bucketId],
  );
  return rowCount > 0;
}
