// PostgresAdapter — restaura dumps SQL (pg_dump plano / .gz) en Cloud SQL for
// PostgreSQL. El flujo destructivo (DROP + CREATE vacía + import) y el polling
// viven en SqlDumpAdapter; aquí solo se especializa el motor.
//
// Nota: Cloud SQL NO importa dumps en formato custom (pg_dump -Fc, .dump); solo
// SQL en texto plano o .gz. Los post-scripts de owner/permisos (ver
// MODELO_HOMOLOGACIONES/scripts_extras) requieren cliente `pg` real y se
// implementarán en el hook runPostScripts en una iteración posterior.
import { SqlDumpAdapter } from '../sqldump/SqlDumpAdapter.js';

export class PostgresAdapter extends SqlDumpAdapter {
  get engineLabel() {
    return 'PostgreSQL';
  }

  get acceptedExtensions() {
    return ['.sql', '.gz'];
  }
}
