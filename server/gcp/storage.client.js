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

/** Nombre de una subcarpeta a partir del prefijo devuelto por GCS ('dir/2026/' -> '2026'). */
export function folderName(fullPrefix, dir) {
  return String(fullPrefix).slice(dir.length).replace(/\/+$/, '');
}

/**
 * Lista UN nivel de la carpeta gs://bucket/prefix: sus archivos y sus subcarpetas
 * (como el navegador de la consola de GCS). Pagina a mano para no perder las
 * subcarpetas (`prefixes`), que la autopaginación de la librería no acumula.
 * @returns {{ files: [{ name, fileName, sizeBytes, updated }], folders: string[] }}
 */
export async function listFolder(gsUri) {
  const { bucket, prefix } = parseGsUri(gsUri);
  const dir = dirPrefix(prefix); // 'datos' -> 'datos/': no mezcla 'datos-old/'
  try {
    const storage = await getStorage();
    const files = [];
    const folders = new Set();
    let query = { prefix: dir, delimiter: '/', autoPaginate: false, maxResults: 1000 };
    while (query) {
      const [page, next, resp] = await storage.bucket(bucket).getFiles(query);
      files.push(...page);
      for (const p of resp?.prefixes ?? []) folders.add(folderName(p, dir));
      query = next;
    }
    return {
      files: files
        .filter((f) => !f.name.endsWith('/')) // marcadores de carpeta vacíos
        .map((f) => ({
          name: f.name,
          fileName: f.name.split('/').pop(),
          sizeBytes: Number(f.metadata.size ?? 0),
          updated: f.metadata.updated ?? null,
        })),
      folders: [...folders].filter(Boolean).sort((x, y) => x.localeCompare(y)),
    };
  } catch (err) {
    throw new InfraError(`No se pudo listar el bucket ${bucket}`, { code: 'GCS_LIST_FAILED', cause: err });
  }
}

/** Archivos que están DIRECTAMENTE en la carpeta (BUCKET_PATH/<archivo>, como el script original). */
export async function listBackups(gsUri) {
  return (await listFolder(gsUri)).files;
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
