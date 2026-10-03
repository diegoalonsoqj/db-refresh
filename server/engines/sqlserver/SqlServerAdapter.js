// SqlServerAdapter — migra la lógica de restore_to_csql.py a la interfaz común.
// Diferencias vs script original:
//  - import/drop vía Cloud SQL Admin API (no `gcloud` CLI ni sqlcmd).
//  - post-scripts: genéricos en EngineAdapter (cliente `mssql`, engines/sql/runners.js).
//  - progreso emitido como job_events (feed SSE).
import { EngineAdapter } from '../EngineAdapter.js';
import { DomainError } from '../../domain/errors.js';
import * as storage from '../../gcp/storage.client.js';
import * as csql from '../../gcp/cloudsql.client.js';
import { config } from '../../config/index.js';

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
}
