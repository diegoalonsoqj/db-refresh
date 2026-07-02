// Bootstrap del servidor Express (API). El worker corre en proceso aparte.
import { config } from './config/index.js';
import { logger } from './lib/logger.js';
import { closePool } from './data/pool.js';
import { ensureBaseAdmin } from './auth/bootstrap.js';
import { createApp } from './app.js';

const app = createApp();

// Garantiza el admin base antes de aceptar tráfico (no bloquea si falla la BD).
await ensureBaseAdmin().catch((err) =>
  logger.error({ err }, 'No se pudo asegurar el admin base'),
);

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.env }, 'API escuchando');
});

async function shutdown(signal) {
  logger.info({ signal }, 'Apagando API...');
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { app };
