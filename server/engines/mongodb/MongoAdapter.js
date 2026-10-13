// MongoAdapter — restore de MongoDB (Community y Atlas) con mongorestore desde el
// servidor de la app, con la conexión y la credencial de la instancia del catálogo.
// No hay Cloud SQL de por medio: ni Admin API, ni estado/operaciones de instancia.
//
// Backups: `mongodump --archive [--gzip]` de db-keeper, una BD por archivo
// (`{BD}_{AMBIENTE}_{AAAAMMDD}_{HHMMSS}.archive[.gz]`). Por item:
//   pre-check: mongorestore instalado, conexión (ping) y cabecera de cada archivo
//              -> BD de origen (antes de borrar nada);
//   prepareTarget: dropDatabase de la BD destino si existe (flujo destructivo uniforme);
//   restore: mongorestore --archive (stdin) [--gzip] --nsInclude origen.*
//            [--nsFrom origen.* --nsTo destino.*] --drop --stopOnError.
import { EngineAdapter } from '../EngineAdapter.js';
import { DomainError } from '../../domain/errors.js';
import {
  assertMongoDbName, MONGO_EXTENSIONS, mongoArchiveFormat, pickSourceDatabase,
} from '../../domain/mongo.js';
import * as storage from '../../gcp/storage.client.js';
import { resolveSqlConnection } from '../sql/connection.js';
import * as mongoClient from './mongo.client.js';
import { readArchivePrelude } from './archive.js';
import { mongorestoreVersion, runMongorestore } from './mongorestore.js';

export class MongoAdapter extends EngineAdapter {
  get acceptedExtensions() {
    return MONGO_EXTENSIONS;
  }

  async listBackups() {
    return storage.listBackups(this.ctx.bucketPath);
  }

  async validateBackup(fileName) {
    if (!mongoArchiveFormat(fileName)) {
      throw new DomainError(`Formato no admitido para MongoDB: ${fileName} (usa .archive o .archive.gz de mongodump --archive)`, {
        code: 'BAD_FORMAT',
      });
    }
    const meta = await storage.statBackup(this.ctx.bucketPath, fileName);
    if (!meta) throw new DomainError(`Backup no encontrado en GCS: ${fileName}`, { code: 'BACKUP_NOT_FOUND' });
    return { ok: true, meta };
  }

  /** Conexión de la instancia (resuelta una vez por job). */
  async _conn() {
    this._connCache ??= await resolveSqlConnection(this.ctx.instance);
    return this._connCache;
  }

  /**
   * BD de origen de un archivo, leída de su cabecera (unos KB del principio del
   * archivo en GCS). Se cachea por archivo para el resto del job.
   */
  async sourceDatabase(fileName) {
    this._sources ??= new Map();
    if (!this._sources.has(fileName)) {
      const { meta } = await this.validateBackup(fileName);
      const { namespaces } = await readArchivePrelude(await storage.openReadStream(meta.gsUri), {
        gzip: mongoArchiveFormat(fileName) === 'archive-gz',
      });
      const db = assertMongoDbName(pickSourceDatabase(namespaces, fileName), `BD de origen de ${fileName}`);
      const collections = namespaces.filter((n) => n.db === db).length;
      this._sources.set(fileName, { db, collections });
    }
    return this._sources.get(fileName);
  }

  /**
   * Pre-check (antes de borrar nada): mongorestore instalado, conexión con la
   * credencial y, por cada archivo, su BD de origen. MongoDB no admite scripts
   * pre/post (son SQL): no se miran.
   */
  async preflight(items = []) {
    await this.ctx.log('info', `Herramienta nativa: ${await mongorestoreVersion()}.`);
    const conn = await this._conn();
    const version = await mongoClient.serverVersion(conn);
    await this.ctx.log('info', `Conexión verificada (${conn.label}, MongoDB ${version}).`);
    for (const item of items) {
      const { db, collections } = await this.sourceDatabase(item.backup_file);
      await this.ctx.log('info',
        `${item.backup_file}: BD de origen ${db} (${collections} colección(es))` +
          `${db === item.target_db ? '' : `, se restaura como ${item.target_db}`}.`, { itemId: item.id });
    }
  }

  // Sin Cloud SQL: no hay estado de instancia ni operaciones en curso que esperar.
  // Entre items basta con que la conexión siga respondiendo.
  async assertInstanceRunning() {
    await mongoClient.ping(await this._conn());
  }

  async waitInstanceIdle() {}

  async prepareTarget(targetDb, item) {
    const dropped = await mongoClient.dropDatabaseIfExists(await this._conn(), targetDb);
    await this.ctx.log('info', dropped
      ? `BD ${targetDb} eliminada.`
      : `La BD ${targetDb} no existe en el servidor; se creará con la restauración.`, { itemId: item?.id ?? null });
  }

  async restore(item) {
    const meta = await storage.statBackup(this.ctx.bucketPath, item.backup_file);
    if (!meta) throw new DomainError(`Backup desaparecido: ${item.backup_file}`, { code: 'BACKUP_NOT_FOUND' });
    const { db: sourceDb } = await this.sourceDatabase(item.backup_file);
    const conn = await this._conn();
    const itemId = item.id;
    await this.ctx.log('info', `Restaurando ${item.backup_file} en la BD ${item.target_db} con mongorestore.`, { itemId });

    const started = Date.now();
    const res = await runMongorestore({
      conn,
      input: await storage.openReadStream(meta.gsUri),
      gzip: mongoArchiveFormat(item.backup_file) === 'archive-gz',
      sourceDb,
      targetDb: item.target_db,
      signal: this.ctx.signal,
      onLine: (level, line) => this.ctx.log(level, `mongorestore: ${line}`, { itemId }),
    });
    if (!res.ok) return { ok: false, error: res.error };
    const docs = res.summary ? `, ${res.summary.restored} documento(s)` : '';
    await this.ctx.log('info', `mongorestore completado en ${Math.round((Date.now() - started) / 1000)}s${docs}.`, { itemId });
    return { ok: true };
  }
}
