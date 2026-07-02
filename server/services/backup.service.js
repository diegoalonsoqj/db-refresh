// Servicio de backups: listar/validar contra GCS a través del adaptador de motor.
import * as catalogRepo from '../data/repositories/catalog.repo.js';
import { createAdapter } from '../engines/index.js';
import { NotFoundError } from '../domain/errors.js';

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

export async function listBackups(instanceId, bucketPath) {
  const ctx = await resolveContext(instanceId, bucketPath);
  const adapter = createAdapter(ctx.instance.engine, ctx);
  const files = await adapter.listBackups();
  return files.filter((f) =>
    adapter.acceptedExtensions.some((ext) => f.fileName.toLowerCase().endsWith(ext)),
  );
}

export async function validateBackup(instanceId, bucketPath, fileName) {
  const ctx = await resolveContext(instanceId, bucketPath);
  const adapter = createAdapter(ctx.instance.engine, ctx);
  return adapter.validateBackup(fileName);
}
