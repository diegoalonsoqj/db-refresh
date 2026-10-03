// Cliente GCS: listar y validar backups. Reemplaza el uso de google.cloud.storage
// de los scripts Python. Auth vía GOOGLE_APPLICATION_CREDENTIALS (ADC).
import { Storage } from '@google-cloud/storage';
import { DomainError, InfraError } from '../domain/errors.js';
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

// Nombres de bucket de GCS: minúsculas, dígitos, '-', '_' y '.', 3-222 caracteres.
const BUCKET_NAME_RE = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;

/**
 * Normaliza la ubicación de un bucket del catálogo (función pura). Acepta que se
 * pegue la ruta completa en el nombre: 'gs://bucket/carpeta' -> bucket + prefijo.
 * El prefijo se guarda sin barras al inicio/fin ('carpeta/sub') o null.
 */
export function normalizeBucketLocation(bucketName, basePrefix) {
  let name = String(bucketName ?? '').trim().replace(/^gs:\/\//i, '');
  let prefix = String(basePrefix ?? '').trim();
  const slash = name.indexOf('/');
  if (slash !== -1) {
    const fromName = name.slice(slash + 1);
    name = name.slice(0, slash);
    prefix = [fromName, prefix].filter(Boolean).join('/');
  }
  if (!BUCKET_NAME_RE.test(name)) {
    throw new DomainError(
      `Nombre de bucket inválido: "${name}". Solo el nombre (p.ej. mi-bucket); la carpeta va en el prefijo`,
      { code: 'BAD_BUCKET_NAME' },
    );
  }
  prefix = prefix.replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
  return { bucketName: name, basePrefix: prefix || null };
}

/** Prefijo como "carpeta": 'a/b' -> 'a/b/' ('' = raíz del bucket). */
export function dirPrefix(prefix) {
  const p = String(prefix ?? '').replace(/^\/+|\/+$/g, '');
  return p ? `${p}/` : '';
}

/**
 * Lista los backups que están DIRECTAMENTE en la carpeta gs://bucket/prefix
 * (no en subcarpetas), como el script original (BUCKET_PATH/<archivo>).
 * @returns [{ name, fileName, sizeBytes, updated }]
 */
export async function listBackups(gsUri) {
  const { bucket, prefix } = parseGsUri(gsUri);
  try {
    const storage = await getStorage();
    // delimiter '/': solo el nivel de la carpeta; dirPrefix evita que 'datos' liste también 'datos-old/'.
    const [files] = await storage.bucket(bucket).getFiles({ prefix: dirPrefix(prefix), delimiter: '/' });
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
