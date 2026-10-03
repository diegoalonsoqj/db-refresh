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
import { resolveSqlConnection } from '../sql/connection.js';
import { withConnection } from './mssql.client.js';
import { describeOrphanResult, ensureDbAccess, fixOrphanUsers } from './orphans.js';

export class SqlServerAdapter extends EngineAdapter {
  get acceptedExtensions() {
    return ['.bak'];
  }

  /** Pre-check: si algún item corrige usuarios huérfanos, la conexión SQL debe funcionar. */
  async preflight(items = []) {
    await super.preflight(items);
    if (items.some((it) => it.fix_orphans) && !this.postScripts.length) {
      await this.ctx.log('info', 'Verificando la conexión SQL para la corrección de usuarios huérfanos.');
      await this.verifyPostScriptsConnection();
      await this.ctx.log('info', 'Conexión SQL verificada.');
    }
  }

  /**
   * Corrige los usuarios huérfanos de la BD recién restaurada. Nunca lanza: los
   * fallos se registran como avisos y la restauración se mantiene correcta.
   */
  async fixOrphans(item) {
    const log = (level, msg) => this.ctx.log(level, msg, { itemId: item.id });
    await log('info', `Corrigiendo usuarios huérfanos de ${item.target_db}.`);
    try {
      const conn = await resolveSqlConnection(this.ctx.instance);
      // 1) Desde master: acceso a la BD restaurada (toma el ownership si hace falta).
      const access = await withConnection(conn, null, (pool) => ensureDbAccess(pool, item.target_db));
      if (access.took) {
        await log('info', `El login ${access.login} no tenía acceso a ${item.target_db}: se le asignó como owner para poder corregirla.`);
      }
      // 2) En la BD: remapeo de usuarios y owner final (el elegido, si se tomó el ownership).
      const result = await withConnection(conn, item.target_db, (pool) =>
        fixOrphanUsers(pool, { database: item.target_db, dbOwner: item.orphan_db_owner, forceOwner: access.took }));
      for (const [level, msg] of describeOrphanResult(item.target_db, result)) await log(level, msg);
      if (access.took && !item.orphan_db_owner) {
        await log('info', `Owner de ${item.target_db}: queda ${access.login} (no se eligió otro).`);
      }
    } catch (err) {
      await log('warning', `No se pudo corregir los usuarios huérfanos de ${item.target_db}: ${err.message}`);
    }
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
