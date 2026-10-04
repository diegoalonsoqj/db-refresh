// Cliente PostgreSQL (pg) para post-scripts. Misma interfaz que mssql.client:
// withConnection(conn, database, fn) + runBatch(client, sql, { onInfo }).
import pg from 'pg';
import { InfraError } from '../../domain/errors.js';
import { config } from '../../config/index.js';

export const defaultDatabase = 'postgres';

function newClient(conn, database, ssl) {
  return new pg.Client({
    host: conn.host,
    port: conn.port,
    user: conn.user,
    password: conn.password,
    database: database || defaultDatabase,
    ssl,
    connectionTimeoutMillis: 15_000,
    statement_timeout: config.worker.postScriptTimeoutMs,
    application_name: 'db-refresh',
  });
}

/** Conecta con TLS (Cloud SQL: certificado propio de la instancia) y, si el servidor no lo soporta, sin TLS. */
async function connect(conn, database) {
  let client = newClient(conn, database, { rejectUnauthorized: false });
  try {
    await client.connect();
    return client;
  } catch (err) {
    await client.end().catch(() => {});
    if (!/does not support SSL/i.test(err.message)) throw err;
  }
  client = newClient(conn, database, false);
  try {
    await client.connect();
    return client;
  } catch (err) {
    await client.end().catch(() => {});
    throw err;
  }
}

export async function withConnection(conn, database, fn) {
  let client;
  try {
    client = await connect(conn, database);
  } catch (err) {
    throw new InfraError(
      `No se pudo conectar a PostgreSQL ${conn.host}:${conn.port}/${database || defaultDatabase}: ${err.message}`,
      { code: 'SQL_CONNECT_FAILED', cause: err },
    );
  }
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Ejecuta el SQL (admite varias sentencias). `onInfo` recibe los RAISE NOTICE.
 * @returns tablas de resultados de los SELECT: [{ columns, rows }]
 */
export async function runBatch(client, batch, { onInfo } = {}) {
  const pending = [];
  const onNotice = (n) => pending.push(onInfo(n.message));
  if (onInfo) client.on('notice', onNotice);
  try {
    const result = await client.query(batch);
    // Varias sentencias -> array de Result; solo las que devuelven columnas (SELECT, RETURNING...).
    return (Array.isArray(result) ? result : [result])
      .filter((r) => r?.fields?.length)
      .map((r) => ({ columns: r.fields.map((f) => f.name), rows: r.rows }));
  } finally {
    if (onInfo) client.off('notice', onNotice);
    await Promise.all(pending);
  }
}
