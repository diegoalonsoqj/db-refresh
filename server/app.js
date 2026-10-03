// Construcción de la app Express (sin `listen`), reutilizable por el servidor
// real (server/index.js) y por los tests de integración.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import router from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { auditMutations } from './middleware/audit.js';
import { config } from './config/index.js';
import { helmetOptions } from './lib/http.js';
import { logger } from './lib/logger.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // 1 = detrás de un proxy (Vite dev / reverse proxy); false si la API está expuesta directa.
  app.set('trust proxy', config.http.trustProxy);
  app.use(helmet(helmetOptions(config.http))); // cabeceras de seguridad (HSTS, nosniff, frameguard, CSP...)
  app.use(express.json({ limit: '256kb' })); // límite de body
  app.use(cookieParser());
  app.use('/api', auditMutations); // registra mutaciones tras responder
  app.use('/api', router);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada', code: 'NOT_FOUND' }));
  mountWeb(app);
  app.use(errorHandler);
  return app;
}

// Sirve el build del frontend (web/dist) en el mismo origen que la API: sin
// reverse proxy, la cookie SameSite=Strict funciona igual que con el proxy de Vite.
function mountWeb(app) {
  const dir = config.http.webDistDir;
  const index = join(dir, 'index.html');
  if (!config.http.serveWeb || !existsSync(index)) {
    if (config.http.serveWeb && config.env === 'production') {
      logger.warn({ dir }, 'No hay build del frontend: ejecuta `npm --prefix web run build`');
    }
    return;
  }
  // Assets con hash en el nombre: cache larga e inmutable.
  app.use('/assets', express.static(join(dir, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }));
  app.use(express.static(dir, { index: false, maxAge: 0 }));
  // Fallback SPA (react-router): cualquier GET que no sea /api ni un fichero -> index.html.
  app.get('*', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
}
