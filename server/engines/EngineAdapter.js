// Interfaz común Strategy/Adapter por motor + factory.
// El core (worker, servicios) NO conoce el motor concreto: opera contra esta interfaz.
import { DomainError } from '../domain/errors.js';

/**
 * Contrato que todo adaptador de motor debe cumplir.
 * `ctx` es el contexto de restauración: { instance, project, bucketPath, log }
 *   - instance: fila de gcp_instances (con project_id, db_host, admin_user, secret_ref...)
 *   - project:  project_id de GCP
 *   - log:      (level, message, {itemId}) => Promise  para emitir eventos de progreso
 */
export class EngineAdapter {
  constructor(ctx) {
    this.ctx = ctx;
  }

  /** Formatos de archivo aceptados por el motor (para validación). */
  get acceptedExtensions() {
    return [];
  }

  /** Lista backups disponibles en el bucket. -> [{ fileName, sizeBytes, updated }] */
  async listBackups() {
    throw new DomainError('listBackups no implementado');
  }

  /** Valida un backup (existencia, tamaño, formato). -> { ok, meta } */
  async validateBackup(_fileName) {
    throw new DomainError('validateBackup no implementado');
  }

  /** Prepara el destino: DROP destructivo de la BD existente. */
  async prepareTarget(_targetDb) {
    throw new DomainError('prepareTarget no implementado');
  }

  /** Lanza el import y espera a que termine. -> { ok, error? } */
  async restore(_item) {
    throw new DomainError('restore no implementado');
  }

  /** Hook post-restore (scripts SQL, jobs). Opcional; por defecto no-op. */
  async runPostScripts() {
    /* no-op por defecto */
  }
}
