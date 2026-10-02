// Interfaz común Strategy/Adapter por motor + factory.
// El core (worker, servicios) NO conoce el motor concreto: opera contra esta interfaz.
import { DomainError, InfraError } from '../domain/errors.js';
import * as csql from '../gcp/cloudsql.client.js';
import { config } from '../config/index.js';

/**
 * Contrato que todo adaptador de motor debe cumplir.
 * `ctx` es el contexto de restauración: { instance, project, bucketPath, log, postScripts }
 *   - instance:    fila de gcp_instances (con project_id, db_host, admin_user, secret_ref...)
 *   - project:     project_id de GCP
 *   - log:         (level, message, {itemId}) => Promise  para emitir eventos de progreso
 *   - postScripts: filas activas de instance_post_scripts, en orden de ejecución
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

  get postScripts() {
    return this.ctx.postScripts ?? [];
  }

  /**
   * Pre-check antes de tocar nada (se llama una vez, antes del primer DROP):
   *  1) la instancia no tiene operaciones en curso (espera hasta un timeout);
   *  2) si hay post-scripts, que se pueda conectar para ejecutarlos. Fallar aquí
   *     es barato; descubrirlo tras el restore deja el job a medias.
   * Lanza si algo falla.
   */
  async preflight() {
    await this.waitInstanceIdle();
    if (this.postScripts.length) {
      await this.ctx.log('info', `🔌 Verificando conexión para ${this.postScripts.length} post-script(s)...`);
      await this.verifyPostScriptsConnection();
      await this.ctx.log('info', '✅ Conexión para post-scripts OK.');
    }
  }

  /** Espera a que la instancia esté libre de operaciones; lanza si no lo queda a tiempo. */
  async waitInstanceIdle({ itemId = null } = {}) {
    const res = await csql.waitForInstanceIdle(
      { project: this.ctx.project, instance: this.ctx.instance.instance_name },
      {
        timeoutSeconds: config.worker.instanceIdleWaitSeconds,
        pollIntervalSeconds: config.worker.operationPollIntervalSeconds,
        onWait: (busy) =>
          this.ctx.log(
            'warning',
            `⏳ Instancia ocupada (${busy.map((o) => `${o.operationType} ${o.status}`).join(', ')}); esperando...`,
            { itemId },
          ),
      },
    );
    if (!res.ok) {
      throw new InfraError(
        `La instancia ${this.ctx.instance.instance_name} sigue con operaciones en curso tras ` +
          `${config.worker.instanceIdleWaitSeconds}s: ${res.busy.map((o) => o.operationType).join(', ')}`,
        { code: 'INSTANCE_BUSY' },
      );
    }
  }

  /** Verifica que se pueden ejecutar los post-scripts. Por defecto: motor sin soporte. */
  async verifyPostScriptsConnection() {
    throw new DomainError(
      `Post-scripts aún no soportados para el motor de ${this.ctx.instance.instance_name}`,
      { code: 'POST_SCRIPTS_UNSUPPORTED' },
    );
  }

  /** Hook post-restore (scripts SQL, jobs). Por defecto: nada si no hay scripts. */
  async runPostScripts() {
    if (this.postScripts.length) await this.verifyPostScriptsConnection();
  }
}
