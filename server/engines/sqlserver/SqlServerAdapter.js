// SqlServerAdapter — migra la lógica de restore_to_csql.py a la interfaz común.
// Diferencias vs script original:
//  - import/drop vía Cloud SQL Admin API (no `gcloud` CLI ni sqlcmd).
//  - post-scripts vía cliente `mssql` (parametrizado donde aplica).
//  - progreso emitido como job_events (feed SSE).
import { EngineAdapter } from '../EngineAdapter.js';
import { DomainError, InfraError } from '../../domain/errors.js';
import { missingSqlCredentials } from '../../domain/instance.js';
import * as storage from '../../gcp/storage.client.js';
import * as csql from '../../gcp/cloudsql.client.js';
import { config } from '../../config/index.js';
import { splitSqlBatches } from '../../lib/sqlBatches.js';
import { withConnection, runBatch } from './mssql.client.js';

export class SqlServerAdapter extends EngineAdapter {
  get acceptedExtensions() {
    return ['.bak'];
  }

  async listBackups() {
    return storage.listBackups(this.ctx.bucketPath);
  }

  async validateBackup(fileName) {
    const lower = fileName.toLowerCase();
    if (!this.acceptedExtensions.some((ext) => lower.endsWith(ext))) {
      throw new DomainError(`Formato no soportado para SQL Server: ${fileName}`, {
        code: 'BAD_FORMAT',
      });
    }
    const meta = await storage.statBackup(this.ctx.bucketPath, fileName);
    if (!meta) {
      throw new DomainError(`Backup no encontrado en GCS: ${fileName}`, { code: 'BACKUP_NOT_FOUND' });
    }
    return { ok: true, meta };
  }

  // DROP destructivo previo al restore (databases.delete del Admin API).
  // El import del .bak crea la BD: basta con eliminarla si ya existe.
  async prepareTarget(targetDb) {
    await this.dropIfExists(targetDb);
  }

  async restore(item) {
    const meta = await storage.statBackup(this.ctx.bucketPath, item.backup_file);
    if (!meta) {
      throw new DomainError(`Backup desaparecido: ${item.backup_file}`, { code: 'BACKUP_NOT_FOUND' });
    }

    await this.ctx.log('info', `Importando ${item.backup_file} en la BD ${item.target_db}.`, {
      itemId: item.id,
    });

    const operation = await csql.importBackup({
      project: this.ctx.project,
      instance: this.ctx.instance.instance_name,
      database: item.target_db,
      uri: meta.gsUri,
      fileType: 'BAK',
    });

    await this.ctx.reportOperation?.(item.id, operation);
    await this.ctx.log('info', `Operación de Cloud SQL (${item.target_db}): ${operation}`, {
      itemId: item.id,
    });

    const res = await csql.waitForOperation(
      { project: this.ctx.project, operation },
      {
        timeoutSeconds: config.worker.operationTimeoutSeconds,
        pollIntervalSeconds: config.worker.operationPollIntervalSeconds,
        onPoll: (status) =>
          this.ctx.log('info', `Estado de ${item.target_db}: ${status}`, { itemId: item.id }),
      },
    );
    return res;
  }

  // Pre-check: login + SELECT 1 contra la BD por defecto (master). No se prueba
  // la database_name de cada script porque suele ser una BD que aún no existe
  // (se crea con el restore).
  async verifyPostScriptsConnection() {
    const missing = missingSqlCredentials(this.ctx.instance);
    if (missing.length) {
      throw new DomainError(
        `La instancia ${this.ctx.instance.instance_name} tiene post-scripts activos pero no tiene ` +
          `conexión SQL (falta: ${missing.join(', ')}). Configúrala en Catálogo → Instancias.`,
        { code: 'POST_SCRIPTS_NO_CREDENTIALS' },
      );
    }
    await withConnection(this.ctx.instance, null, (pool) => runBatch(pool, 'SELECT 1'));
  }

  // Ejecuta los post-scripts activos en orden (equivale a run_extra_scripts del
  // script original). Cada script abre su conexión (en su database_name) y corre
  // sus lotes GO en secuencia; los PRINT se vuelcan al log del job.
  // A diferencia del original, el primer fallo detiene el resto: un script
  // posterior puede depender del anterior y el job queda en failed.
  async runPostScripts() {
    for (const script of this.postScripts) {
      const batches = splitSqlBatches(script.sql_text);
      const where = script.database_name ?? 'master';
      await this.ctx.log('info', `Post-script "${script.name}" en ${where}: ${batches.length} lote(s).`);
      try {
        await withConnection(this.ctx.instance, script.database_name, async (pool) => {
          for (const [i, batch] of batches.entries()) {
            try {
              await runBatch(pool, batch, {
                onInfo: (msg) => this.ctx.log('info', `   ${msg}`),
              });
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
