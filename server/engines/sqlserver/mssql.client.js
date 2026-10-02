// Cliente SQL Server (mssql/tedious) para lo que el Admin API no cubre: los
// post-scripts SQL. Conecta con el usuario admin de la instancia del catálogo y
// el password resuelto desde secret_ref (Secret Manager / env), nunca logueado.
import sql from 'mssql';
import { InfraError } from '../../domain/errors.js';
import { resolveSecret } from '../../lib/secrets.js';
import { config } from '../../config/index.js';

async function connectionConfig(instance, database) {
  return {
    server: instance.db_host,
    port: instance.db_port ?? 1433,
    user: instance.admin_user,
    password: await resolveSecret(instance.secret_ref),
    ...(database ? { database } : {}),
    // Igual que el script original (Encrypt=yes;TrustServerCertificate=yes):
    // Cloud SQL usa un certificado propio de la instancia, no de una CA pública.
    options: { encrypt: true, trustServerCertificate: true },
    connectionTimeout: 15_000,
    requestTimeout: config.worker.postScriptTimeoutMs,
    pool: { max: 1, min: 0 },
  };
}

/** Abre una conexión (pool de 1) y la cierra siempre al terminar `fn`. */
export async function withConnection(instance, database, fn) {
  const cfg = await connectionConfig(instance, database);
  const pool = new sql.ConnectionPool(cfg);
  try {
    await pool.connect();
  } catch (err) {
    throw new InfraError(
      `No se pudo conectar a SQL Server ${cfg.server}:${cfg.port}${database ? `/${database}` : ''}: ${err.message}`,
      { code: 'SQL_CONNECT_FAILED', cause: err },
    );
  }
  try {
    return await fn(pool);
  } finally {
    await pool.close().catch(() => {});
  }
}

/** Ejecuta un lote T-SQL tal cual (sin `GO`). `onInfo` recibe los PRINT. */
export async function runBatch(pool, batch, { onInfo } = {}) {
  const request = pool.request();
  const pending = [];
  if (onInfo) request.on('info', (m) => pending.push(onInfo(m.message)));
  try {
    await request.batch(batch);
  } finally {
    await Promise.all(pending);
  }
}
