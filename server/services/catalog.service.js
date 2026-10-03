// Servicio de catálogo: reglas de negocio y validación sobre proyectos,
// instancias, buckets y su relación N:N. Traduce errores de integridad de PG.
import * as repo from '../data/repositories/catalog.repo.js';
import * as postScriptsRepo from '../data/repositories/postScripts.repo.js';
import { mapPgError } from '../data/pgErrors.js';
import { NotFoundError, ValidationError } from '../domain/errors.js';
import { missingSqlCredentials } from '../domain/instance.js';
import { assertNonEmpty, assertOneOf, optionalString } from '../lib/validation.js';
import { parseSecretRef } from '../lib/secrets.js';
import { normalizeBucketLocation } from '../gcp/storage.client.js';

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
  // Conexión SQL (host/usuario/secret_ref): opcional, solo para post-scripts.
  // Todo o nada, para no guardar una conexión a medias.
  const dbHost = optionalString(input.dbHost, 'dbHost');
  const adminUser = optionalString(input.adminUser, 'adminUser');
  // secret_ref es una REFERENCIA (p.ej. Secret Manager), nunca el password.
  const secretRef = optionalString(input.secretRef, 'secretRef');
  const given = [dbHost, adminUser, secretRef].filter(Boolean).length;
  if (given > 0 && given < 3) {
    throw new ValidationError(
      'Conexión SQL incompleta: indica host, usuario admin y secret ref, o deja los tres vacíos',
    );
  }
  if (secretRef) parseSecretRef(secretRef); // valida el formato (sm://... | env:NOMBRE)
  return {
    projectRef,
    instanceName: assertNonEmpty(input.instanceName, 'instanceName'),
    engine: assertOneOf(input.engine, ENGINES, 'engine'),
    dbHost,
    dbPort: dbHost ? input.dbPort || null : null,
    adminUser,
    secretRef,
    isActive: input.isActive ?? true,
  };
}

// Sin conexión SQL no se pueden ejecutar post-scripts: impedir quitarla si hay activos.
async function assertCredentialsForActiveScripts(instanceId, data) {
  const missing = missingSqlCredentials({
    db_host: data.dbHost, admin_user: data.adminUser, secret_ref: data.secretRef,
  });
  if (!missing.length) return;
  const active = await postScriptsRepo.listForInstance(instanceId, { onlyActive: true });
  if (active.length) {
    throw new ValidationError(
      `La instancia tiene ${active.length} post-script(s) activo(s) que necesitan la conexión SQL; ` +
        'desactívalos antes de quitarla',
    );
  }
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
  await assertCredentialsForActiveScripts(id, data);
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
  const { bucketName, basePrefix } = normalizeBucketLocation(
    assertNonEmpty(input.bucketName, 'bucketName'),
    optionalString(input.basePrefix, 'basePrefix'),
  );
  return {
    projectRef,
    bucketName,
    basePrefix,
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
