// Cliente MySQL (mysql2) para post-scripts. Misma interfaz que mssql.client:
// withConnection(conn, database, fn) + runBatch(connection, sql, { onInfo }).
import mysql from 'mysql2/promise';
import { InfraError } from '../../domain/errors.js';
import { config } from '../../config/index.js';

export const defaultDatabase = null; // sin BD por defecto: el script puede usar USE / nombres calificados

function options(conn, database, ssl) {
  return {
    host: conn.host,
    port: conn.port,
    user: conn.user,
    password: conn.password,
    ...(database ? { database } : {}),
    multipleStatements: true, // un post-script puede tener varias sentencias
    connectTimeout: 15_000,
    ...(ssl ? { ssl } : {}),
  };
}

/** Conecta con TLS (Cloud SQL: certificado propio de la instancia) y, si el servidor no lo soporta, sin TLS. */
async function connect(conn, database) {
  try {
    return await mysql.createConnection(options(conn, database, { rejectUnauthorized: false }));
  } catch (err) {
    if (!/does not support secure connection|HANDSHAKE_NO_SSL_SUPPORT/i.test(`${err.code} ${err.message}`)) throw err;
  }
  return mysql.createConnection(options(conn, database, null));
}

export async function withConnection(conn, database, fn) {
  let connection;
  try {
    connection = await connect(conn, database);
  } catch (err) {
    throw new InfraError(
      `No se pudo conectar a MySQL ${conn.host}:${conn.port}${database ? `/${database}` : ''}: ${err.message}`,
      { code: 'SQL_CONNECT_FAILED', cause: err },
    );
  }
  try {
    return await fn(connection);
  } finally {
    await connection.end().catch(() => {});
  }
}

/**
 * Ejecuta el SQL (admite varias sentencias). MySQL no tiene PRINT: `onInfo` no se usa.
 * @returns tablas de resultados de los SELECT: [{ columns, rows }]
 */
export async function runBatch(connection, batch) {
  const [results, fields] = await connection.query({ sql: batch, timeout: config.worker.postScriptTimeoutMs });
  // Con varias sentencias: results/fields son arrays por sentencia; las que no son
  // SELECT devuelven un ResultSetHeader (no array) y fields undefined.
  const multi = Array.isArray(fields) && fields.some((f) => Array.isArray(f) || f === undefined);
  const sets = multi ? results.map((r, i) => [r, fields[i]]) : [[results, fields]];
  return sets
    .filter(([r, f]) => Array.isArray(r) && Array.isArray(f))
    .map(([r, f]) => ({ columns: f.map((c) => c.name), rows: r }));
}
