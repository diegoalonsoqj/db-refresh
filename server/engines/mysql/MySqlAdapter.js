// MySqlAdapter — restaura dumps SQL (mysqldump / .gz) en Cloud SQL for MySQL.
// El flujo destructivo (DROP + CREATE vacía + import) y el polling viven en
// SqlDumpAdapter; aquí solo se especializa el motor.
//
// Nota: se asume dump de un único esquema SIN `CREATE DATABASE`/`USE` (mysqldump
// sin --databases); el import se dirige a la BD recién creada mediante el campo
// `database` del importContext.
import { SqlDumpAdapter } from '../sqldump/SqlDumpAdapter.js';

export class MySqlAdapter extends SqlDumpAdapter {
  get engineLabel() {
    return 'MySQL';
  }

  get acceptedExtensions() {
    return ['.sql', '.gz'];
  }
}
