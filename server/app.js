// Construcción de la app Express (sin `listen`), reutilizable por el servidor
// real (server/index.js) y por los tests de integración.
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import router from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { auditMutations } from './middleware/audit.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // detrás de proxy (Vite dev / reverse proxy): req.ip real
  app.use(helmet()); // cabeceras de seguridad (HSTS, nosniff, frameguard, CSP...)
  app.use(express.json({ limit: '256kb' })); // límite de body
  app.use(cookieParser());
  app.use('/api', auditMutations); // registra mutaciones tras responder
  app.use('/api', router);
  app.use(errorHandler);
  return app;
}
