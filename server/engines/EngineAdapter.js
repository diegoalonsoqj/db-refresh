// Interfaz común Strategy/Adapter por motor + factory.
// El core (worker, servicios) NO conoce el motor concreto: opera contra esta interfaz.
import { DomainError, InfraError } from '../domain/errors.js';
import * as csql from '../gcp/cloudsql.client.js';
import { config } from '../config/index.js';
import { splitSqlBatches } from '../lib/sqlBatches.js';
import { sqlRunnerFor } from './sql/runners.js';
import { resolveSqlConnection } from './sql/connection.js';

/**
 * Contrato que todo adaptador de motor debe cumplir.
 * `ctx` es el contexto de restauración: { instance, project, bucketPath, log, postScripts }
 *   - instance:    fila de gcp_instances (con project_id, db_host, db_port, credential_ref...)
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

  /**
   * DROP destructivo (databases.delete) solo si la BD existe: una BD nueva no se
   * intenta borrar. Lanza DROP_FAILED con el motivo que devuelve GCP.
   */
  async dropIfExists(targetDb) {
    const where = { project: this.ctx.project, instance: this.ctx.instance.instance_name, database: targetDb };
    if (!(await csql.databaseExists(where))) {
      await this.ctx.log('info', `La BD ${targetDb} no existe en la instancia; se creará con la restauración.`);
      return;
    }
    await this.ctx.log('info', `Eliminando la BD existente ${targetDb}.`);
    const op = await csql.deleteDatabase(where);
    if (op === null) {
      await this.ctx.log('info', `La BD ${targetDb} no existía; no hay nada que eliminar.`);
      return;
    }
    const res = await csql.waitForOperation(
      { project: this.ctx.project, operation: op },
      {
        timeoutSeconds: config.worker.operationTimeoutSeconds,
        pollIntervalSeconds: config.worker.operationPollIntervalSeconds,
      },
    );
    if (!res.ok) {
      throw new InfraError(`No se pudo eliminar la BD ${targetDb}`, { code: 'DROP_FAILED', cause: res.error });
    }
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
      await this.ctx.log('info', `Verificando la conexión SQL para ${this.postScripts.length} post-script(s).`);
      await this.verifyPostScriptsConnection();
      await this.ctx.log('info', 'Conexión SQL para post-scripts verificada.');
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
            `Instancia ocupada (${busy.map((o) => `${o.operationType} ${o.status}`).join(', ')}); en espera.`,
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

  /** Cliente SQL del motor de la instancia (null = el motor no admite post-scripts). */
  get sqlRunner() {
    return sqlRunnerFor(this.ctx.instance?.engine);
  }

  _requireRunner() {
    if (!this.sqlRunner) {
      throw new DomainError(
        `Post-scripts no soportados para el motor de ${this.ctx.instance.instance_name}`,
        { code: 'POST_SCRIPTS_UNSUPPORTED' },
      );
    }
    return this.sqlRunner;
  }

  /**
   * Pre-check de post-scripts: conexión SQL configurada (host + credencial) y
   * login + SELECT 1 en la BD por defecto. No se prueba la database_name de cada
   * script porque suele ser una BD que aún no existe (se crea con el restore).
   */
  async verifyPostScriptsConnection() {
    const runner = this._requireRunner();
    const conn = await resolveSqlConnection(this.ctx.instance);
    await runner.withConnection(conn, null, (handle) => runner.runBatch(handle, 'SELECT 1'));
  }

  /**
   * Ejecuta los post-scripts activos en orden (equivale a run_extra_scripts del
   * script original). Cada script abre su conexión (en su database_name) y corre
   * sus lotes en secuencia (`GO` separa lotes; en PG/MySQL suele haber uno solo);
   * los PRINT / RAISE NOTICE van al log del job. El primer fallo detiene el resto:
   * un script posterior puede depender del anterior y el job queda en failed.
   */
  async runPostScripts() {
    if (!this.postScripts.length) return;
    const runner = this._requireRunner();
    const conn = await resolveSqlConnection(this.ctx.instance);
    for (const script of this.postScripts) {
      const batches = splitSqlBatches(script.sql_text);
      const where = script.database_name ?? runner.defaultDatabase ?? 'BD por defecto';
      await this.ctx.log('info', `Post-script "${script.name}" en ${where}: ${batches.length} lote(s).`);
      try {
        await runner.withConnection(conn, script.database_name, async (handle) => {
          for (const [i, batch] of batches.entries()) {
            try {
              await runner.runBatch(handle, batch, { onInfo: (msg) => this.ctx.log('info', `  ${msg}`) });
            } catch (err) {
              throw new InfraError(`lote ${i + 1}/${batches.length}: ${err.message}`, {
                code: 'POST_SCRIPT_FAILED',
                cause: err,
              });
            }
          }
        });
      } catch (err) {
        throw new InfraError(`Post-script "${script.name}" falló: ${err.message}`, {
          code: 'POST_SCRIPT_FAILED',
          cause: err,
        });
      }
      await this.ctx.log('info', `Post-script "${script.name}" completado.`);
    }
  }
}
