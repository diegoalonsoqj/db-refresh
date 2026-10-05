// Servicio de catálogo: reglas de negocio y validación sobre proyectos,
// instancias, buckets y su relación N:N. Traduce errores de integridad de PG.
import * as repo from '../data/repositories/catalog.repo.js';
import * as postScriptsRepo from '../data/repositories/postScripts.repo.js';
import { mapPgError } from '../data/pgErrors.js';
import { NotFoundError, ValidationError } from '../domain/errors.js';
import { missingSqlCredentials } from '../domain/instance.js';
import { assertNonEmpty, assertOneOf, optionalString } from '../lib/validation.js';
import * as credentialsRepo from '../data/repositories/credentials.repo.js';
import { normalizeBucketLocation } from '../gcp/storage.client.js';

const ENGINES = ['sqlserver', 'postgres', 'mysql']; // = enum engine_type
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const engine = assertOneOf(input.engine, ENGINES, 'engine');
  // Conexión SQL (IP privada + credencial): opcional, solo para post-scripts.
  // Se admite host sin credencial (p.ej. instancias migradas: aún no ejecutan
  // post-scripts), pero no una credencial sin host al que conectarse.
  const dbHost = optionalString(input.dbHost, 'dbHost');
  const credentialRef = optionalString(input.credentialRef, 'credentialRef');
  if (credentialRef && !dbHost) {
    throw new ValidationError('Indica el host (IP privada) de la instancia para usar la credencial');
  }
  if (credentialRef) {
    if (!UUID_RE.test(credentialRef)) throw new ValidationError(`credentialRef inválido: ${credentialRef}`);
    const cred = await credentialsRepo.getCredentialById(credentialRef);
    if (!cred) throw new NotFoundError(`Credencial ${credentialRef} no encontrada`);
    if (cred.engine !== engine) {
      throw new ValidationError(`La credencial "${cred.name}" es de ${cred.engine}; la instancia es ${engine}`);
    }
  }
  const dbPort = dbHost && input.dbPort ? Number(input.dbPort) : null;
  if (dbPort !== null && !(Number.isInteger(dbPort) && dbPort > 0 && dbPort < 65536)) {
    throw new ValidationError(`dbPort inválido: ${input.dbPort}`);
  }
  return {
    projectRef,
    instanceName: assertNonEmpty(input.instanceName, 'instanceName'),
    engine,
    dbHost,
    dbPort,
    credentialRef,
    isActive: input.isActive ?? true,
  };
}

// Sin conexión SQL no se pueden ejecutar scripts (pre/post): impedir quitarla si hay activos.
async function assertCredentialsForActiveScripts(instanceId, data) {
  const missing = missingSqlCredentials({ db_host: data.dbHost, credential_ref: data.credentialRef });
  if (!missing.length) return;
  const active = await postScriptsRepo.listForInstance(instanceId, { onlyActive: true });
  if (active.length) {
    throw new ValidationError(
      `La instancia tiene ${active.length} script(s) pre/post activo(s) que necesitan la conexión SQL; ` +
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
