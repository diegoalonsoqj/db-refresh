// Migración simple: aplica db/schema.sql (idempotente) contra la BD de la app.
// Para migraciones versionadas futuras se puede pasar a node-pg-migrate.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool, closePool } from '../server/data/pool.js';
import { logger } from '../server/lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const sql = await readFile(join(__dirname, 'schema.sql'), 'utf8');
  logger.info('Aplicando db/schema.sql...');
  await pool.query(sql);
  logger.info('Esquema aplicado correctamente.');
}

main()
  .catch((err) => {
    logger.error({ err }, 'Fallo al aplicar el esquema');
    process.exitCode = 1;
  })
  .finally(closePool);
