// Servicio de catálogo: reglas de negocio y validación sobre proyectos,
// instancias, buckets y su relación N:N. Traduce errores de integridad de PG.
import * as repo from '../data/repositories/catalog.repo.js';
import { mapPgError } from '../data/pgErrors.js';
import { NotFoundError } from '../domain/errors.js';
import { assertNonEmpty, assertOneOf } from '../lib/validation.js';

const ENGINES = ['sqlserver', 'postgres', 'mysql']; // = enum engine_type

// --- Proyectos -------------------------------------------------------------
export const listProjects = () => repo.listProjects();

export async function getProject(id) {
  const p = await repo.getProjectById(id);
  if (!p) throw new NotFoundError(`Proyecto ${id} no encontrado`);
  return p;
}

export async function createProject(input) {
  const projectId = assertNonEmpty(input.projectId, 'projectId');
  try {
    return await repo.createProject({ projectId, description: input.description });
  } catch (err) {
    throw mapPgError(err, { entity: 'Proyecto' });
  }
}

export async function updateProject(id, input) {
  await getProject(id);
  const projectId = assertNonEmpty(input.projectId, 'projectId');
  try {
    return await repo.updateProject(id, { projectId, description: input.description });
  } catch (err) {
    throw mapPgError(err, { entity: 'Proyecto' });
  }
}

export async function deleteProject(id) {
  await getProject(id);
  try {
    await repo.deleteProject(id);
  } catch (err) {
    throw mapPgError(err, { entity: 'Proyecto' });
  }
}

// --- Instancias ------------------------------------------------------------
export const listInstances = () => repo.listInstances();

export async function getInstance(id) {
  const i = await repo.getInstanceById(id);
  if (!i) throw new NotFoundError(`Instancia ${id} no encontrada`);
  return i;
}

async function validateInstanceInput(input) {
  const projectRef = assertNonEmpty(input.projectRef, 'projectRef');
  if (!(await repo.getProjectById(projectRef))) {
    throw new NotFoundError(`Proyecto ${projectRef} no encontrado`);
  }
  return {
    projectRef,
    instanceName: assertNonEmpty(input.instanceName, 'instanceName'),
    engine: assertOneOf(input.engine, ENGINES, 'engine'),
    dbHost: assertNonEmpty(input.dbHost, 'dbHost'),
    dbPort: input.dbPort ?? null,
    adminUser: assertNonEmpty(input.adminUser, 'adminUser'),
    // secret_ref es una REFERENCIA (p.ej. Secret Manager), nunca el password.
    secretRef: assertNonEmpty(input.secretRef, 'secretRef'),
    isActive: input.isActive ?? true,
  };
}

export async function createInstance(input) {
  const data = await validateInstanceInput(input);
  try {
    return await repo.createInstance(data);
  } catch (err) {
    throw mapPgError(err, { entity: 'Instancia' });
  }
}

export async function updateInstance(id, input) {
  await getInstance(id);
  const data = await validateInstanceInput(input);
  try {
    return await repo.updateInstance(id, data);
  } catch (err) {
    throw mapPgError(err, { entity: 'Instancia' });
  }
}

export async function deleteInstance(id) {
  await getInstance(id);
  try {
    await repo.deleteInstance(id);
  } catch (err) {
    throw mapPgError(err, { entity: 'Instancia' });
  }
}

// --- Buckets ---------------------------------------------------------------
export const listBuckets = () => repo.listBuckets();

export async function getBucket(id) {
  const b = await repo.getBucketById(id);
  if (!b) throw new NotFoundError(`Bucket ${id} no encontrado`);
  return b;
}

async function validateBucketInput(input) {
  const projectRef = assertNonEmpty(input.projectRef, 'projectRef');
  if (!(await repo.getProjectById(projectRef))) {
    throw new NotFoundError(`Proyecto ${projectRef} no encontrado`);
  }
  return {
    projectRef,
    bucketName: assertNonEmpty(input.bucketName, 'bucketName'),
    basePrefix: input.basePrefix ?? null,
    description: input.description ?? null,
    isActive: input.isActive ?? true,
  };
}

export async function createBucket(input) {
  const data = await validateBucketInput(input);
  try {
    return await repo.createBucket(data);
  } catch (err) {
    throw mapPgError(err, { entity: 'Bucket' });
  }
}

export async function updateBucket(id, input) {
  await getBucket(id);
  const data = await validateBucketInput(input);
  try {
    return await repo.updateBucket(id, data);
  } catch (err) {
    throw mapPgError(err, { entity: 'Bucket' });
  }
}

export async function deleteBucket(id) {
  await getBucket(id);
  try {
    await repo.deleteBucket(id);
  } catch (err) {
    throw mapPgError(err, { entity: 'Bucket' });
  }
}

// --- Relación N:N ----------------------------------------------------------
export async function listInstanceBuckets(instanceId) {
  await getInstance(instanceId);
  return repo.listBucketsForInstance(instanceId);
}

export async function linkBucket(instanceId, input) {
  await getInstance(instanceId);
  const bucketId = assertNonEmpty(input.bucketId, 'bucketId');
  await getBucket(bucketId); // 404 si no existe
  try {
    return await repo.linkInstanceBucket(instanceId, bucketId, Boolean(input.isDefault));
  } catch (err) {
    throw mapPgError(err, { entity: 'Vínculo instancia-bucket' });
  }
}

export async function unlinkBucket(instanceId, bucketId) {
  const removed = await repo.unlinkInstanceBucket(instanceId, bucketId);
  if (!removed) throw new NotFoundError('El vínculo instancia-bucket no existe');
}
