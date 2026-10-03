// Clientes SQL por motor con la misma interfaz:
//   withConnection(conn, database, fn), runBatch(handle, sql, { onInfo }), defaultDatabase
// Los usan los post-scripts (EngineAdapter) y la prueba de conexión de credenciales.
import * as mssqlClient from '../sqlserver/mssql.client.js';
import * as pgClient from '../postgres/pg.client.js';
import * as mysqlClient from '../mysql/mysql.client.js';

const RUNNERS = { sqlserver: mssqlClient, postgres: pgClient, mysql: mysqlClient };

/** Cliente SQL del motor, o null si no hay. */
export function sqlRunnerFor(engine) {
  return RUNNERS[engine] ?? null;
}

/** Login + SELECT 1 en la BD por defecto del motor. Lanza si falla. */
export async function testSqlConnection(conn) {
  const runner = sqlRunnerFor(conn.engine);
  await runner.withConnection(conn, null, (handle) => runner.runBatch(handle, 'SELECT 1'));
}
