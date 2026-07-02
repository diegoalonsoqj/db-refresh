// Pool de conexiones a la BD de la app (PostgreSQL 17).
// Toda query de la app pasa por aquí; SIEMPRE parametrizada ($1, $2...).
import pg from 'pg';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

const { Pool } = pg;

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  max: config.db.poolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Error inesperado en cliente idle del pool');
});

/** Ejecuta una query parametrizada. `text` con placeholders $1.. y `params` array. */
export function query(text, params) {
  return pool.query(text, params);
}

/**
 * Ejecuta `fn` dentro de una transacción con un cliente dedicado.
 * Hace COMMIT si resuelve, ROLLBACK si lanza. Siempre libera el cliente.
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}
