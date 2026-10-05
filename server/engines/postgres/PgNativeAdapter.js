// PgNativeAdapter — restore nativo de PostgreSQL con pg_restore (dump tar,
// pg_dump -Ft) o psql (dump plano .sql / .sql.gz), ejecutados en este servidor
// contra la IP privada de la instancia con la credencial SQL del catálogo.
//
// Alcance por item:
//  - 'database': DROP de la BD (Admin API, o por SQL si se pidió) + CREATE vacía + restore completo.
//  - 'schema'  : en la BD existente, DROP SCHEMA ... CASCADE y restore de ese
//                esquema (tar: pg_restore --schema, que no crea el esquema, así
//                que se crea antes; plano: el dump debe ser de ese esquema
//                -pg_dump -n- y trae su propio CREATE SCHEMA).
// El dump se lee de GCS en streaming hacia stdin (sin disco ni memoria extra).
import { createGunzip } from 'node:zlib';
import { EngineAdapter } from '../EngineAdapter.js';
import { DomainError } from '../../domain/errors.js';
import { NATIVE_EXTENSIONS, nativeDumpFormat } from '../../domain/restoreMapping.js';
import * as storage from '../../gcp/storage.client.js';
import * as csql from '../../gcp/cloudsql.client.js';
import { config } from '../../config/index.js';
import { resolveSqlConnection } from '../sql/connection.js';
import * as pgClient from './pg.client.js';
import {
  buildPgRestoreArgs, buildPsqlArgs, pgEnv, quoteIdent, runTool, toolPath, toolVersion,
} from './nativeTools.js';

export class PgNativeAdapter extends EngineAdapter {
  get acceptedExtensions() {
    return NATIVE_EXTENSIONS;
  }

  async listBackups() {
    return storage.listBackups(this.ctx.bucketPath);
  }

  async validateBackup(fileName) {
    if (!nativeDumpFormat(fileName)) {
      throw new DomainError(`Formato no admitido para el restore nativo: ${fileName} (usa .tar, .sql o .sql.gz)`, {
        code: 'BAD_FORMAT',
      });
    }
    const meta = await storage.statBackup(this.ctx.bucketPath, fileName);
    if (!meta) throw new DomainError(`Backup no encontrado en GCS: ${fileName}`, { code: 'BACKUP_NOT_FOUND' });
    return { ok: true, meta };
  }

  /** Conexión SQL de la instancia (resuelta una vez por job). */
  async _conn() {
    this._connCache ??= await resolveSqlConnection(this.ctx.instance);
    return this._connCache;
  }

  /** SQL de mantenimiento (DROP/CREATE SCHEMA, ALTER DATABASE) con la credencial. */
  async _exec(database, sql) {
    const conn = await this._conn();
    await pgClient.withConnection(conn, database, (client) => pgClient.runBatch(client, sql));
  }

  /**
   * Pre-check específico (además de instancia libre y post-scripts):
   * pg_restore/psql instalados, conexión con la credencial y, para los items por
   * esquema, que la BD destino exista.
   */
  async preflight(items = []) {
    await super.preflight(items);
    const [restore, psql] = await Promise.all([toolVersion('pg_restore'), toolVersion('psql')]);
    await this.ctx.log('info', `Herramientas nativas: ${restore.text}; ${psql.text}.`);
    const conn = await this._conn();
    await pgClient.withConnection(conn, null, (client) => pgClient.runBatch(client, 'SELECT 1'));
    await this.ctx.log('info', `Conexión SQL verificada (${conn.label}).`);
    for (const item of items.filter((it) => it.scope === 'schema')) {
      const exists = await csql.databaseExists({
        project: this.ctx.project, instance: this.ctx.instance.instance_name, database: item.target_db,
      });
      if (!exists) {
        throw new DomainError(
          `La BD ${item.target_db} no existe: para restaurar solo el esquema ${item.schema_name} la BD debe existir`,
          { code: 'TARGET_DB_MISSING' },
        );
      }
    }
  }

  async prepareTarget(targetDb, item) {
    const role = item.import_user;
    if (item.scope === 'schema') {
      const schema = quoteIdent(item.schema_name);
      await this.ctx.log('info', `Eliminando el esquema ${item.schema_name} de ${targetDb} (CASCADE).`, { itemId: item.id });
      // pg_restore --schema no restaura el CREATE SCHEMA: se crea aquí (plano: lo trae el dump).
      const create = nativeDumpFormat(item.backup_file) === 'tar'
        ? ` CREATE SCHEMA ${schema}${role ? ` AUTHORIZATION ${quoteIdent(role)}` : ''};`
        : '';
      await this._exec(targetDb, `DROP SCHEMA IF EXISTS ${schema} CASCADE;${create}`);
      return;
    }
    await this.dropTarget(targetDb, item);
    await this.createEmptyDatabase(targetDb);
    if (role) {
      await this.ctx.log('info', `Asignando ${role} como owner de la BD ${targetDb}.`, { itemId: item.id });
      await this._exec(null, `ALTER DATABASE ${quoteIdent(targetDb)} OWNER TO ${quoteIdent(role)};`);
    }
  }

  async restore(item) {
    const meta = await storage.statBackup(this.ctx.bucketPath, item.backup_file);
    if (!meta) throw new DomainError(`Backup desaparecido: ${item.backup_file}`, { code: 'BACKUP_NOT_FOUND' });
    const format = nativeDumpFormat(item.backup_file);
    const conn = await this._conn();
    const role = item.import_user ?? null;

    const tool = format === 'tar' ? 'pg_restore' : 'psql';
    const args = format === 'tar'
      ? buildPgRestoreArgs({ database: item.target_db, schemaName: item.schema_name, role })
      : buildPsqlArgs({ database: item.target_db, role });
    const what = item.scope === 'schema' ? `el esquema ${item.schema_name} de ${item.target_db}` : `la BD ${item.target_db}`;
    await this.ctx.log('info', `Restaurando ${item.backup_file} en ${what} con ${tool}${role ? ` (rol ${role})` : ''}.`, {
      itemId: item.id,
    });

    const source = await storage.openReadStream(meta.gsUri);
    const input = format === 'plain-gz' ? source.pipe(createGunzip()) : source;
    if (format === 'plain-gz') source.on('error', (err) => input.destroy(err));

    const started = Date.now();
    const { code, tail, linesOmitted } = await runTool({
      cmd: toolPath(tool),
      args,
      env: pgEnv(conn),
      input,
      keepStdout: false,
      timeoutMs: config.nativeRestore.timeoutSeconds * 1000,
      onLine: (line) => this.ctx.log(/error|fatal/i.test(line) ? 'error' : 'info', `${tool}: ${line}`, { itemId: item.id }),
    });
    if (linesOmitted) {
      await this.ctx.log('warning', `${tool}: ${linesOmitted} línea(s) de salida adicionales omitidas.`, { itemId: item.id });
    }
    if (code !== 0) {
      return { ok: false, error: { message: `${tool} terminó con código ${code}: ${tail.slice(-3).join(' | ')}` } };
    }
    await this.ctx.log('info', `${tool} completado en ${Math.round((Date.now() - started) / 1000)}s.`, { itemId: item.id });
    return { ok: true };
  }
}
