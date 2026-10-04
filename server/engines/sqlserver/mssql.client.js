// Cliente SQL Server (mssql/tedious) para lo que el Admin API no cubre: los
// post-scripts SQL. Recibe una conexión ya resuelta (engines/sql/connection.js).
import sql from 'mssql';
import { InfraError } from '../../domain/errors.js';
import { config } from '../../config/index.js';

export const defaultDatabase = 'master';

/** Abre una conexión (pool de 1) y la cierra siempre al terminar `fn`. */
export async function withConnection(conn, database, fn) {
  const pool = new sql.ConnectionPool({
    server: conn.host,
    port: conn.port,
    user: conn.user,
    password: conn.password,
    ...(database ? { database } : {}),
    // Igual que el script original (Encrypt=yes;TrustServerCertificate=yes):
    // Cloud SQL usa un certificado propio de la instancia, no de una CA pública.
    options: { encrypt: true, trustServerCertificate: true },
    connectionTimeout: 15_000,
    requestTimeout: config.worker.postScriptTimeoutMs,
    pool: { max: 1, min: 0 },
  });
  try {
    await pool.connect();
  } catch (err) {
    throw new InfraError(
      `No se pudo conectar a SQL Server ${conn.host}:${conn.port}${database ? `/${database}` : ''}: ${err.message}`,
      { code: 'SQL_CONNECT_FAILED', cause: err },
    );
  }
  try {
    return await fn(pool);
  } finally {
    await pool.close().catch(() => {});
  }
}

/**
 * Consulta parametrizada: `params` = { nombre: valor } (NVARCHAR). Devuelve el recordset.
 * Los nombres que acaban en SQL dinámico se citan en el servidor con QUOTENAME.
 */
export async function runQuery(pool, query, params = {}) {
  const request = pool.request();
  for (const [name, value] of Object.entries(params)) request.input(name, sql.NVarChar(4000), value);
  const { recordset } = await request.query(query);
  return recordset ?? [];
}

/**
 * Ejecuta un lote T-SQL tal cual (sin `GO`). `onInfo` recibe los PRINT.
 * @returns tablas de resultados de los SELECT: [{ columns, rows }]
 */
export async function runBatch(pool, batch, { onInfo } = {}) {
  const request = pool.request();
  const pending = [];
  if (onInfo) request.on('info', (m) => pending.push(onInfo(m.message)));
  try {
    const result = await request.batch(batch);
    return (result?.recordsets ?? []).map((rs) => ({
      columns: rs.columns ? Object.keys(rs.columns) : Object.keys(rs[0] ?? {}),
      rows: [...rs],
    }));
  } finally {
    await Promise.all(pending);
  }
}
