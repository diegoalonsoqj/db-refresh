// PostgresAdapter — restaura dumps SQL (pg_dump plano / .gz) en Cloud SQL for
// PostgreSQL. El flujo destructivo (DROP + CREATE vacía + import) y el polling
// viven en SqlDumpAdapter; aquí se especializa el motor y el owner de la BD.
//
// Nota: Cloud SQL NO importa dumps en formato custom (pg_dump -Fc, .dump); solo
// SQL en texto plano o .gz. Los post-scripts (owner/permisos, ver
// MODELO_HOMOLOGACIONES/scripts_extras) se ejecutan con el cliente `pg`
// (EngineAdapter.runPostScripts) usando la credencial SQL de la instancia.
import { SqlDumpAdapter } from '../sqldump/SqlDumpAdapter.js';
import { resolveSqlConnection } from '../sql/connection.js';
import { setDatabaseOwner } from './dbOwner.js';

export class PostgresAdapter extends SqlDumpAdapter {
  get engineLabel() {
    return 'PostgreSQL';
  }

  get acceptedExtensions() {
    return ['.sql', '.gz'];
  }

  /** Con owner elegido hay que asignarlo por SQL (ver prepareTarget): la conexión es obligatoria. */
  async preflight(items = []) {
    await super.preflight(items);
    const owned = items.filter((it) => it.import_user).length;
    if (owned) await this.ensureSqlConnection(`asignar el owner de ${owned} BD`, { required: true });
  }

  /**
   * DROP + CREATE vacía y, si se eligió owner (importUser), se le asigna la BD:
   * el import corre como ese usuario y, en una BD de cloudsqlsuperuser, no puede
   * crear esquemas ("permission denied for database"). Queda como la dejaba el
   * restore anterior (BD del owner); para volver a borrarla hará falta «Borrar por SQL».
   */
  async prepareTarget(targetDb, item) {
    await super.prepareTarget(targetDb, item);
    if (!item?.import_user) return;
    await setDatabaseOwner({
      conn: await resolveSqlConnection(this.ctx.instance),
      database: targetDb,
      role: item.import_user,
      log: (level, msg) => this.ctx.log(level, msg, { itemId: item.id }),
    });
  }
}
