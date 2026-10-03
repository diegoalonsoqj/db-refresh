// Definición de rutas (thin). Auth/RBAC se añadirá como middleware en fase posterior.
import { Router } from 'express';
import * as restore from '../controllers/restore.controller.js';
import * as settings from '../controllers/settings.controller.js';
import * as auth from '../controllers/auth.controller.js';
import * as catalog from '../controllers/catalog.controller.js';
import * as schedule from '../controllers/schedule.controller.js';
import * as usersCtl from '../controllers/users.controller.js';
import * as postScripts from '../controllers/postScripts.controller.js';
import * as credentials from '../controllers/credentials.controller.js';
import { authenticate, requireRole } from '../auth/middleware.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { pool } from '../data/pool.js';
import { config } from '../config/index.js';

// `with { type: 'json' }` evita leer el package.json a mano solo para la versión.
import pkg from '../../package.json' with { type: 'json' };

export const router = Router();

const admin = [authenticate, requireRole('admin')];
const operator = [authenticate, requireRole('operator', 'admin')];

// Público y barato: `ok` se mantiene por compatibilidad; el resto alimenta la
// sección "Sistema" de Ajustes (estado de la BD, versión, uptime).
router.get('/health', async (_req, res) => {
  const started = Date.now();
  let db = false;
  let dbLatencyMs = null;
  try {
    await pool.query('SELECT 1');
    db = true;
    dbLatencyMs = Date.now() - started;
  } catch {
    db = false; // la API responde igual: el health refleja el fallo, no lo propaga
  }
  res.json({
    ok: true,
    db,
    dbLatencyMs,
    version: pkg.version,
    env: config.env,
    uptimeSecs: Math.floor(process.uptime()),
    now: new Date().toISOString(),
  });
});

// --- Auth ---
router.get('/auth/methods', auth.methods); // público: qué fuentes hay (local/ad)
router.post('/auth/login', loginLimiter, auth.login);
router.post('/auth/logout', auth.logout);
router.get('/auth/me', authenticate, auth.me);
router.post('/auth/change-password', authenticate, auth.changePassword);

// --- Usuarios y auditoría (solo admin) ---
router.get('/users', ...admin, usersCtl.list);
router.post('/users', ...admin, usersCtl.create);
router.patch('/users/:id', ...admin, usersCtl.update);
router.post('/users/:id/reset-password', ...admin, usersCtl.resetPassword);
router.delete('/users/:id', ...admin, usersCtl.remove);
router.get('/audit', ...admin, usersCtl.audit);

// Lecturas: cualquier usuario autenticado (viewer, operator, admin).
router.get('/backups', authenticate, restore.listBackups);
// Lee el índice de un dump tar (ejecuta pg_restore en el servidor): operator/admin.
router.get('/backups/schemas', ...operator, restore.listDumpSchemas);
router.get('/restores', authenticate, restore.listJobs);
router.get('/restores/:id', authenticate, restore.getJob);
router.get('/restores/:id/events', authenticate, restore.streamJob); // SSE

// Lanzar restore es destructivo: solo operator/admin.
router.post('/restores', authenticate, requireRole('operator', 'admin'), restore.launchRestore);

// --- Settings (AD/LDAP + GCP service account) — solo admin ---
router.get('/settings/ad', ...admin, settings.getAd);
router.put('/settings/ad', ...admin, settings.putAd);
router.post('/settings/ad/test', ...admin, settings.testAd);
router.get('/settings/gcp', ...admin, settings.getGcp);
router.put('/settings/gcp', ...admin, settings.putGcp);
router.post('/settings/gcp/test', ...admin, settings.testGcp);

// --- Catálogo GCP: lecturas autenticadas, escrituras solo admin ---
router.get('/projects', authenticate, catalog.listProjects);
router.post('/projects', ...admin, catalog.createProject);
router.get('/projects/:id', authenticate, catalog.getProject);
router.put('/projects/:id', ...admin, catalog.updateProject);
router.delete('/projects/:id', ...admin, catalog.deleteProject);

router.get('/instances', authenticate, catalog.listInstances);
router.post('/instances', ...admin, catalog.createInstance);
router.get('/instances/:id', authenticate, catalog.getInstance);
router.put('/instances/:id', ...admin, catalog.updateInstance);
router.delete('/instances/:id', ...admin, catalog.deleteInstance);
router.get('/instances/:id/buckets', authenticate, catalog.listInstanceBuckets);
// BDs/usuarios reales de la instancia (Admin API): para preparar restores -> operator/admin.
router.get('/instances/:id/databases', ...operator, catalog.listInstanceDatabases);
router.get('/instances/:id/users', ...operator, catalog.listInstanceUsers);
router.get('/instances/:id/status', ...operator, catalog.getInstanceStatus);
router.get('/instances/:id/logins', ...operator, catalog.listInstanceLogins);
router.post('/instances/:id/buckets', ...admin, catalog.linkBucket);
router.delete('/instances/:id/buckets/:bucketId', ...admin, catalog.unlinkBucket);
// Post-scripts: SQL arbitrario que se ejecuta contra la instancia (y puede
// contener datos sensibles) -> lectura y escritura solo admin.
// --- Credenciales SQL (solo admin: secretos y conexión a instancias) ---
router.get('/credentials', ...admin, credentials.list);
router.post('/credentials', ...admin, credentials.create);
router.get('/credentials/:id', ...admin, credentials.get);
router.put('/credentials/:id', ...admin, credentials.update);
router.delete('/credentials/:id', ...admin, credentials.remove);
router.post('/credentials/:id/test', ...admin, credentials.test);
router.post('/instances/:id/test-connection', ...admin, credentials.testInstance);

router.get('/instances/:id/post-scripts', ...admin, postScripts.list);
router.post('/instances/:id/post-scripts', ...admin, postScripts.create);
router.put('/instances/:id/post-scripts/:scriptId', ...admin, postScripts.update);
router.delete('/instances/:id/post-scripts/:scriptId', ...admin, postScripts.remove);

router.get('/buckets', authenticate, catalog.listBuckets);
router.post('/buckets', ...admin, catalog.createBucket);
router.get('/buckets/:id', authenticate, catalog.getBucket);
router.put('/buckets/:id', ...admin, catalog.updateBucket);
router.delete('/buckets/:id', ...admin, catalog.deleteBucket);

// --- Schedules: lecturas autenticadas, escrituras/disparo operator|admin ---
router.get('/schedules', authenticate, schedule.listSchedules);
router.post('/schedules', ...operator, schedule.createSchedule);
router.get('/schedules/:id', authenticate, schedule.getSchedule);
router.put('/schedules/:id', ...operator, schedule.updateSchedule);
router.delete('/schedules/:id', ...operator, schedule.deleteSchedule);
router.post('/schedules/:id/run', ...operator, schedule.runSchedule);

export default router;
