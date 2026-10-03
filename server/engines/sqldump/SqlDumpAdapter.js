// Base para motores que restauran a partir de dumps SQL vía Cloud SQL Admin API
// (fileType 'SQL', soporta .gz): PostgreSQL y MySQL.
//
// Diferencia clave frente a SQL Server (.bak, que recrea la BD al importar):
// el import de un dump SQL escribe en una BD que DEBE EXISTIR. Por eso el flujo
// destructivo aquí es DROP + CREATE (BD vacía) antes de importar. Se asume que el
// dump NO contiene su propio CREATE DATABASE/USE (dump de un único esquema); en
// ese caso el `database` del importContext dirige el import a la BD recién creada.
import { EngineAdapter } from '../EngineAdapter.js';
import { DomainError, InfraError } from '../../domain/errors.js';
import * as storage from '../../gcp/storage.client.js';
import * as csql from '../../gcp/cloudsql.client.js';
import { config } from '../../config/index.js';

export class SqlDumpAdapter extends EngineAdapter {
  /** Nombre legible del motor (para logs y mensajes de error). */
  get engineLabel() {
    return 'SQL';
  }

  // Cloud SQL para PG/MySQL solo importa dumps SQL en texto plano (o .gz).
  get acceptedExtensions() {
    return ['.sql', '.gz'];
  }

  async listBackups() {
    return storage.listBackups(this.ctx.bucketPath);
  }

  async validateBackup(fileName) {
    const lower = fileName.toLowerCase();
    if (!this.acceptedExtensions.some((ext) => lower.endsWith(ext))) {
      throw new DomainError(`Formato no soportado para ${this.engineLabel}: ${fileName}`, {
        code: 'BAD_FORMAT',
      });
    }
    const meta = await storage.statBackup(this.ctx.bucketPath, fileName);
    if (!meta) {
      throw new DomainError(`Backup no encontrado en GCS: ${fileName}`, { code: 'BACKUP_NOT_FOUND' });
    }
    return { ok: true, meta };
  }

  // Flujo destructivo: eliminar la BD y recrearla vacía para recibir el import.
  async prepareTarget(targetDb) {
    await this._dropDatabase(targetDb);
    await this._createEmptyDatabase(targetDb);
  }

  async _dropDatabase(targetDb) {
    await this.ctx.log('info', `🧹 Eliminando BD existente: ${targetDb}`);
    const op = await csql.deleteDatabase({
      project: this.ctx.project,
      instance: this.ctx.instance.instance_name,
      database: targetDb,
    });
    if (op === null) {
      await this.ctx.log('info', `ℹ️ La BD ${targetDb} no existía; nada que eliminar.`);
      return;
    }
    const res = await this._wait(op);
    if (!res.ok) {
      throw new InfraError(`No se pudo eliminar la BD ${targetDb}`, {
        code: 'DROP_FAILED',
        cause: res.error,
      });
    }
  }

  async _createEmptyDatabase(targetDb) {
    await this.ctx.log('info', `📦 Creando BD vacía: ${targetDb}`);
    const op = await csql.createDatabase({
      project: this.ctx.project,
      instance: this.ctx.instance.instance_name,
      database: targetDb,
    });
    const res = await this._wait(op);
    if (!res.ok) {
      throw new InfraError(`No se pudo crear la BD ${targetDb}`, {
        code: 'CREATE_DB_FAILED',
        cause: res.error,
      });
    }
  }

  async restore(item) {
    const meta = await storage.statBackup(this.ctx.bucketPath, item.backup_file);
    if (!meta) {
      throw new DomainError(`Backup desaparecido: ${item.backup_file}`, { code: 'BACKUP_NOT_FOUND' });
    }

    await this.ctx.log('info', `🚀 Importando ${item.backup_file} → ${item.target_db}`, {
      itemId: item.id,
    });

    const operation = await csql.importBackup({
      project: this.ctx.project,
      instance: this.ctx.instance.instance_name,
      database: item.target_db,
      uri: meta.gsUri,
      fileType: 'SQL', // PostgreSQL / MySQL (incl. .gz)
      importUser: item.import_user ?? undefined, // solo PG (validado al lanzar)
    });
    if (item.import_user) {
      await this.ctx.log('info', `👤 Owner del import: ${item.import_user}`, { itemId: item.id });
    }

    await this.ctx.reportOperation?.(item.id, operation);
    await this.ctx.log('info', `ℹ️ Operation ID (${item.target_db}): ${operation}`, {
      itemId: item.id,
    });

    return this._wait(operation, {
      onPoll: (status) =>
        this.ctx.log('info', `ℹ️ Estado ${item.target_db}: ${status}`, { itemId: item.id }),
    });
  }

  /** Helper de polling con los timeouts del worker. */
  _wait(operation, extra = {}) {
    return csql.waitForOperation(
      { project: this.ctx.project, operation },
      {
        timeoutSeconds: config.worker.operationTimeoutSeconds,
        pollIntervalSeconds: config.worker.operationPollIntervalSeconds,
        ...extra,
      },
    );
  }
}
