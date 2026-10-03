// Servicio de backups: listar/validar contra GCS a través del adaptador de motor.
import * as catalogRepo from '../data/repositories/catalog.repo.js';
import { createAdapter } from '../engines/index.js';
import { InfraError, NotFoundError, ValidationError } from '../domain/errors.js';
import { nativeDumpFormat } from '../domain/restoreMapping.js';
import { parseTocSchemas, runTool, toolPath } from '../engines/postgres/nativeTools.js';
import * as storage from '../gcp/storage.client.js';

async function resolveContext(instanceId, bucketPath) {
  const instance = await catalogRepo.getInstanceById(instanceId);
  if (!instance) throw new NotFoundError(`Instancia ${instanceId} no encontrada`);
  return {
    instance,
    project: instance.project_id,
    bucketPath,
    log: async () => {}, // sin progreso en operaciones de solo lectura
  };
}

/**
 * Contenido de una carpeta del bucket: subcarpetas (para navegar) y los backups
 * con extensión válida para el motor de la instancia.
 * @returns {{ files, folders }}
 */
export async function listBackups(instanceId, bucketPath, method = 'import') {
  const ctx = await resolveContext(instanceId, bucketPath);
  const adapter = createAdapter(ctx.instance.engine, ctx, method === 'native' ? 'native' : 'import');
  storage.parseGsUri(bucketPath); // valida formato gs://
  const { files, folders } = await storage.listFolder(bucketPath);
  return {
    folders,
    files: files.filter((f) =>
      adapter.acceptedExtensions.some((ext) => f.fileName.toLowerCase().endsWith(ext)),
    ),
  };
}

export async function validateBackup(instanceId, bucketPath, fileName) {
  const ctx = await resolveContext(instanceId, bucketPath);
  const adapter = createAdapter(ctx.instance.engine, ctx);
  return adapter.validateBackup(fileName);
}

/**
 * Esquemas que contiene un dump tar (pg_dump -Ft), leyendo su índice con
 * `pg_restore -l` en streaming desde GCS. Para el selector de esquema del
 * restore nativo. Los dumps planos no tienen índice: el esquema se escribe a mano.
 */
export async function listDumpSchemas(instanceId, bucketPath, fileName) {
  const ctx = await resolveContext(instanceId, bucketPath);
  const adapter = createAdapter(ctx.instance.engine, ctx, 'native');
  if (nativeDumpFormat(fileName) !== 'tar') {
    throw new ValidationError('Solo los dumps .tar (pg_dump -Ft) permiten leer sus esquemas');
  }
  const { meta } = await adapter.validateBackup(fileName);
  const input = await storage.openReadStream(meta.gsUri);
  const { code, stdout, tail } = await runTool({
    cmd: toolPath('pg_restore'), args: ['--list'], input, timeoutMs: 120_000,
  });
  input.destroy(); // pg_restore -l solo necesita el índice del principio del tar
  if (code !== 0) throw new InfraError(`pg_restore --list falló: ${tail.slice(-2).join(' | ')}`, { code: 'DUMP_LIST_FAILED' });
  return parseTocSchemas(stdout);
}
