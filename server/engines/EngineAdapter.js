// Interfaz común Strategy/Adapter por motor + factory.
// El core (worker, servicios) NO conoce el motor concreto: opera contra esta interfaz.
import { DomainError, InfraError } from '../domain/errors.js';
import * as csql from '../gcp/cloudsql.client.js';
import { config } from '../config/index.js';
import { runPostScript } from './sql/postScriptRunner.js';
import { sqlRunnerFor } from './sql/runners.js';
import { resolveSqlConnection } from './sql/connection.js';

/**
 * Contrato que todo adaptador de motor debe cumplir.
 * `ctx` es el contexto de restauración: { instance, project, bucketPath, log, preScripts, postScripts }
 *   - instance:    fila de gcp_instances (con project_id, db_host, db_port, credential_ref...)
 *   - project:     project_id de GCP
 *   - log:         (level, message, {itemId}) => Promise  para emitir eventos de progreso
 *   - preScripts:  filas activas de instance_post_scripts (phase 'pre'), en orden de ejecución
 *   - postScripts: ídem (phase 'post')
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

  /** Crea una BD vacía (databases.insert) y espera a que termine la operación. */
  async createEmptyDatabase(targetDb) {
    await this.ctx.log('info', `Creando la BD vacía ${targetDb}.`);
    const op = await csql.createDatabase({
      project: this.ctx.project,
      instance: this.ctx.instance.instance_name,
      database: targetDb,
    });
    const res = await csql.waitForOperation(
      { project: this.ctx.project, operation: op },
      {
        timeoutSeconds: config.worker.operationTimeoutSeconds,
        pollIntervalSeconds: config.worker.operationPollIntervalSeconds,
      },
    );
    if (!res.ok) {
      throw new InfraError(`No se pudo crear la BD ${targetDb}`, { code: 'CREATE_DB_FAILED', cause: res.error });
    }
  }

  get preScripts() {
    return this.ctx.preScripts ?? [];
  }

  get postScripts() {
    return this.ctx.postScripts ?? [];
  }

  /**
   * Pre-check antes de tocar nada (se llama una vez, antes del primer DROP):
   *  1) la instancia no tiene operaciones en curso (espera hasta un timeout);
   *  2) si hay pre/post-scripts, que se pueda conectar para ejecutarlos. Fallar aquí
   *     es barato; descubrirlo tras el restore deja el job a medias. Los pre-scripts
   *     exigen la conexión siempre (preparan algo que el restore necesita), aunque
   *     se haya pedido continuar sin conexión SQL.
   * Lanza si algo falla.
   */
  async preflight(_items = []) {
    await this.assertInstanceRunning();
    await this.waitInstanceIdle();
    if (this.preScripts.length) {
      await this.ensureSqlConnection(`${this.preScripts.length} pre-script(s)`, { required: true });
    }
    if (this.postScripts.length) await this.ensureSqlConnection(`${this.postScripts.length} post-script(s)`);
  }

  /**
   * Verifica (una vez por job) la conexión SQL que necesitan los post-scripts y la
   * corrección de huérfanos. Si falla: sin la opción `skipSqlOnFailure` lanza (el
   * pre-check aborta sin tocar nada); con ella deja `sqlUnavailable` con el motivo
   * y el job restaura igualmente, omitiendo esos pasos. Con `required` (pre-scripts)
   * lanza siempre.
   */
  async ensureSqlConnection(purpose, { required = false } = {}) {
    if (this.sqlChecked || this.sqlUnavailable) return;
    await this.ctx.log('info', `Verificando la conexión SQL para ${purpose}.`);
    try {
      await this.verifyPostScriptsConnection();
      this.sqlChecked = true;
      await this.ctx.log('info', 'Conexión SQL verificada.');
    } catch (err) {
      if (required || !this.ctx.skipSqlOnFailure) throw err;
      this.sqlUnavailable = err.message;
      await this.ctx.log('warning',
        `No hay conexión SQL (${err.message}). Se restaurará igualmente, como se pidió al lanzar; ` +
          'se omitirán los post-scripts y la corrección de usuarios huérfanos.');
    }
  }

  /**
   * La instancia debe estar encendida: detenida (activationPolicy NEVER) o en
   * mantenimiento, el Admin API rechaza drop/import ("instance is not running").
   */
  async assertInstanceRunning() {
    const name = this.ctx.instance.instance_name;
    const st = await csql.getInstanceStatus({ project: this.ctx.project, instance: name });
    if (!st.running) {
      throw new DomainError(
        `La instancia ${name} ${st.reason}. Iníciala (consola de GCP o ` +
          `gcloud sql instances patch ${name} --activation-policy=ALWAYS) y vuelve a lanzar el restore.`,
        { code: 'INSTANCE_NOT_RUNNING' },
      );
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
        `Scripts SQL no soportados para el motor de ${this.ctx.instance.instance_name}`,
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
   * los PRINT / RAISE NOTICE y las tablas de los SELECT (reportes) van al log del job. El primer fallo detiene el resto:
   * un script posterior puede depender del anterior y el job queda en failed.
   */
  async runPostScripts() {
    await this._runScripts(this.postScripts);
  }

  /**
   * Ejecuta los pre-scripts activos en orden, una vez por job, tras el pre-check y
   * antes del primer DROP. El primer fallo detiene el resto y aborta el job.
   */
  async runPreScripts() {
    await this._runScripts(this.preScripts);
  }

  async _runScripts(scripts) {
    if (!scripts.length) return;
    const runner = this._requireRunner();
    const conn = await resolveSqlConnection(this.ctx.instance);
    for (const script of scripts) {
      await runPostScript({ runner, conn, script, log: (level, msg) => this.ctx.log(level, msg) });
    }
  }
}
