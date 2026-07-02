// Cliente GCS: listar y validar backups. Reemplaza el uso de google.cloud.storage
// de los scripts Python. Auth vía GOOGLE_APPLICATION_CREDENTIALS (ADC).
import { Storage } from '@google-cloud/storage';
import { InfraError } from '../domain/errors.js';
import { getSaCredentials } from '../services/settings.service.js';
import { currentEpoch } from './state.js';

// Cliente GCS bajo demanda: SA de settings (cifrada en BD) o ADC como fallback.
// Cacheado; se reconstruye cuando cambia el epoch (nueva SA guardada).
let cache = { epoch: -1, storage: null };

async function getStorage() {
  const epoch = currentEpoch();
  if (cache.storage && cache.epoch === epoch) return cache.storage;
  const sa = await getSaCredentials();
  const storage = new Storage(
    sa ? { credentials: sa.credentials, projectId: sa.projectId } : {},
  );
  cache = { epoch, storage };
  return storage;
}

/** Parsea 'gs://bucket/prefijo/...' en { bucket, prefix }. */
export function parseGsUri(gsUri) {
  const m = /^gs:\/\/([^/]+)\/?(.*)$/.exec(gsUri);
  if (!m) throw new InfraError(`URI de GCS inválida: ${gsUri}`, { code: 'BAD_GS_URI' });
  return { bucket: m[1], prefix: m[2] ?? '' };
}

/**
 * Lista los objetos bajo gs://bucket/prefix.
 * @returns [{ name, fileName, sizeBytes, updated }]
 */
export async function listBackups(gsUri) {
  const { bucket, prefix } = parseGsUri(gsUri);
  try {
    const storage = await getStorage();
    const [files] = await storage.bucket(bucket).getFiles({ prefix });
    return files
      .filter((f) => !f.name.endsWith('/'))
      .map((f) => ({
        name: f.name,
        fileName: f.name.split('/').pop(),
        sizeBytes: Number(f.metadata.size ?? 0),
        updated: f.metadata.updated ?? null,
      }));
  } catch (err) {
    throw new InfraError(`No se pudo listar el bucket ${bucket}`, { code: 'GCS_LIST_FAILED', cause: err });
  }
}

/**
 * Verifica que un archivo exista bajo el prefijo y devuelve su metadata.
 * @returns { fileName, gsUri, sizeBytes, updated } | null
 */
export async function statBackup(baseGsUri, fileName) {
  const files = await listBackups(baseGsUri);
  const match = files.find((f) => f.fileName === fileName);
  if (!match) return null;
  const { bucket } = parseGsUri(baseGsUri);
  return {
    fileName: match.fileName,
    gsUri: `gs://${bucket}/${match.name}`,
    sizeBytes: match.sizeBytes,
    updated: match.updated,
  };
}
