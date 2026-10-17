// Repositorio de catálogo GCP (proyectos, instancias, buckets, N:N).
// Todas las queries parametrizadas. Los repos no validan reglas de negocio
// (eso es del servicio); solo acceso a datos.
import { query, withTransaction } from '../pool.js';
import { SqlWhere, orderBy, pagedQuery } from '../../lib/listQuery.js';

// --- Proyectos -------------------------------------------------------------
export async function listProjects() {
  const { rows } = await query(
    `SELECT id, project_id, description, created_at FROM gcp_projects ORDER BY project_id`,
  );
  return rows;
}

const PROJECT_ORDER = { projectId: 'lower(project_id)', created: 'created_at' };
export const PROJECT_SORTS = Object.keys(PROJECT_ORDER);

/** Proyectos paginados. Búsqueda: project_id y descripción. */
export async function listProjectsPaged({ limit, offset, q, sort, dir }) {
  return pagedQuery(query, {
    select: 'SELECT id, project_id, description, created_at FROM gcp_projects',
    countFrom: 'gcp_projects',
    where: new SqlWhere().search(['project_id', 'description'], q),
    order: orderBy(PROJECT_ORDER, sort, dir, { sort: 'projectId', dir: 'asc' }, 'id'),
    limit,
    offset,
  });
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
// La credencial se expone solo por nombre/usuario (nunca su secreto).
const INSTANCE_COLS = `i.id, i.project_ref, i.instance_name, i.engine, i.db_host, i.db_port,
            i.mongo_srv, i.conn_options,
            i.credential_ref, c.name AS credential_name, c.username AS credential_username,
            i.is_active, i.created_at, p.project_id`;

export async function getInstanceById(id) {
  const { rows } = await query(
    `SELECT ${INSTANCE_COLS}
       FROM gcp_instances i
       JOIN gcp_projects p ON p.id = i.project_ref
       LEFT JOIN sql_credentials c ON c.id = i.credential_ref
      WHERE i.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function listInstances() {
  const { rows } = await query(
    `SELECT ${INSTANCE_COLS}
       FROM gcp_instances i
       JOIN gcp_projects p ON p.id = i.project_ref
       LEFT JOIN sql_credentials c ON c.id = i.credential_ref
      ORDER BY p.project_id, i.instance_name`,
  );
  return rows;
}

const INSTANCE_FROM = `gcp_instances i
       JOIN gcp_projects p ON p.id = i.project_ref
       LEFT JOIN sql_credentials c ON c.id = i.credential_ref`;
const INSTANCE_ORDER = {
  instance: 'lower(i.instance_name)',
  engine: 'i.engine::text',
  project: 'lower(p.project_id)',
  status: 'i.is_active',
};
export const INSTANCE_SORTS = Object.keys(INSTANCE_ORDER);

/** Instancias paginadas. Búsqueda: nombre, proyecto, host y credencial. */
export async function listInstancesPaged({ limit, offset, q, sort, dir, filters = {} }) {
  const where = new SqlWhere()
    .search(['i.instance_name', 'p.project_id', 'i.db_host', 'c.name'], q)
    .eq('i.engine::text', filters.engine)
    .eq('p.project_id', filters.project);
  if (filters.active !== undefined) where.add(`i.is_active = ${where.param(filters.active)}`);
  return pagedQuery(query, {
    select: `SELECT ${INSTANCE_COLS} FROM ${INSTANCE_FROM}`,
    countFrom: INSTANCE_FROM,
    where,
    order: orderBy(INSTANCE_ORDER, sort, dir, { sort: 'project', dir: 'asc' }, 'lower(i.instance_name), i.id'),
    limit,
    offset,
  });
}

export async function createInstance(inst) {
  const { rows } = await query(
    `INSERT INTO gcp_instances
       (project_ref, instance_name, engine, db_host, db_port, credential_ref, is_active, mongo_srv, conn_options)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      inst.projectRef, inst.instanceName, inst.engine, inst.dbHost,
      inst.dbPort ?? null, inst.credentialRef ?? null, inst.isActive ?? true,
      inst.mongoSrv ?? false, JSON.stringify(inst.connOptions ?? {}),
    ],
  );
  return getInstanceById(rows[0].id);
}

export async function updateInstance(id, inst) {
  const { rows } = await query(
    `UPDATE gcp_instances
        SET project_ref = $2, instance_name = $3, engine = $4, db_host = $5,
            db_port = $6, credential_ref = $7, is_active = $8, mongo_srv = $9, conn_options = $10
      WHERE id = $1
      RETURNING id`,
    [
      id, inst.projectRef, inst.instanceName, inst.engine, inst.dbHost,
      inst.dbPort ?? null, inst.credentialRef ?? null, inst.isActive ?? true,
      inst.mongoSrv ?? false, JSON.stringify(inst.connOptions ?? {}),
    ],
  );
  return rows[0] ? getInstanceById(id) : null;
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

const BUCKET_FROM = 'gcp_buckets b JOIN gcp_projects p ON p.id = b.project_ref';
const BUCKET_ORDER = {
  bucket: 'lower(b.bucket_name)',
  project: 'lower(p.project_id)',
  status: 'b.is_active',
};
export const BUCKET_SORTS = Object.keys(BUCKET_ORDER);

/** Buckets paginados. Búsqueda: nombre, prefijo, proyecto y descripción. */
export async function listBucketsPaged({ limit, offset, q, sort, dir, filters = {} }) {
  const where = new SqlWhere()
    .search(['b.bucket_name', 'b.base_prefix', 'p.project_id', 'b.description'], q)
    .eq('p.project_id', filters.project);
  if (filters.active !== undefined) where.add(`b.is_active = ${where.param(filters.active)}`);
  return pagedQuery(query, {
    select: `SELECT b.id, b.project_ref, b.bucket_name, b.base_prefix, b.description,
                    b.is_active, b.created_at, p.project_id
               FROM ${BUCKET_FROM}`,
    countFrom: BUCKET_FROM,
    where,
    order: orderBy(BUCKET_ORDER, sort, dir, { sort: 'project', dir: 'asc' }, 'lower(b.bucket_name), b.id'),
    limit,
    offset,
  });
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
