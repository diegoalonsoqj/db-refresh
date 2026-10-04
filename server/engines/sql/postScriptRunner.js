// Ejecución de UN post-script con el cliente SQL del motor. La comparten el
// worker (EngineAdapter.runPostScripts, tras un restore) y el botón "Ejecutar"
// del modal de post-scripts (postScripts.service.runNow).
// Cada script abre su conexión (en su database_name) y corre sus lotes en
// secuencia (`GO` separa lotes); PRINT / RAISE NOTICE y las tablas de los
// SELECT van a `log`. Lanza en el primer lote que falle.
import { InfraError } from '../../domain/errors.js';
import { splitSqlBatches } from '../../lib/sqlBatches.js';
import { formatResultSet } from '../../lib/resultSets.js';

/**
 * @param runner cliente SQL del motor (engines/sql/runners.js)
 * @param conn   conexión resuelta (engines/sql/connection.js)
 * @param script fila de instance_post_scripts
 * @param log    async (level, message) => void
 */
export async function runPostScript({ runner, conn, script, log }) {
  const batches = splitSqlBatches(script.sql_text);
  const where = script.database_name ?? runner.defaultDatabase ?? 'BD por defecto';
  await log('info', `Post-script "${script.name}" en ${where}: ${batches.length} lote(s).`);
  try {
    await runner.withConnection(conn, script.database_name, async (handle) => {
      for (const [i, batch] of batches.entries()) {
        try {
          const sets = await runner.runBatch(handle, batch, { onInfo: (msg) => log('info', `  ${msg}`) });
          // Tablas de reporte del script (SELECT), con las filas de error como aviso.
          for (const set of sets ?? []) {
            for (const [level, text] of formatResultSet(set.rows, set.columns)) await log(level, `  ${text}`);
          }
        } catch (err) {
          throw new InfraError(`lote ${i + 1}/${batches.length}: ${err.message}`, { code: 'POST_SCRIPT_FAILED', cause: err });
        }
      }
    });
  } catch (err) {
    throw new InfraError(`Post-script "${script.name}" falló: ${err.message}`, { code: 'POST_SCRIPT_FAILED', cause: err });
  }
  await log('info', `Post-script "${script.name}" completado.`);
}
