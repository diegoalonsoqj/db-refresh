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
import * as dashboard from '../controllers/dashboard.controller.js';
import * as roles from '../controllers/roles.controller.js';
import { authenticate, authorize } from '../auth/middleware.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { pool } from '../data/pool.js';
import { config } from '../config/index.js';

// `with { type: 'json' }` evita leer el package.json a mano solo para la versión.
import pkg from '../../package.json' with { type: 'json' };

export const router = Router();

// Autorización por permisos `recurso:acción` (RBAC granular, como db-keeper).
const can = (...perms) => [authenticate, authorize(...perms)];

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

// --- Usuarios y auditoría ---
router.get('/users', ...can('users:read'), usersCtl.list);
router.post('/users', ...can('users:write'), usersCtl.create);
router.patch('/users/:id', ...can('users:write'), usersCtl.update);
router.post('/users/:id/reset-password', ...can('users:write'), usersCtl.resetPassword);
router.delete('/users/:id', ...can('users:delete'), usersCtl.remove);
router.get('/audit', ...can('audit:read'), usersCtl.audit);

router.get('/backups', ...can('tasks:write'), restore.listBackups);
// Listar backups y leer el índice de un dump tar: para preparar tareas (tocan GCS / pg_restore).
router.get('/backups/schemas', ...can('tasks:write'), restore.listDumpSchemas);
// Panel (página de inicio): indicadores, últimos restores y próximas ejecuciones. Cualquier autenticado.
router.get('/dashboard', authenticate, dashboard.getDashboard);
router.get('/restores', ...can('jobs:read'), restore.listJobs);
router.get('/restores/:id', ...can('jobs:read'), restore.getJob);
router.get('/restores/:id/events', ...can('jobs:read'), restore.streamJob); // SSE

// Lanzamiento directo (heredado; la UI ejecuta tareas) y cancelación.
router.post('/restores', ...can('tasks:run'), restore.launchRestore);
router.post('/restores/:id/cancel', ...can('jobs:cancel'), restore.cancelJob);

// --- Settings (AD/LDAP + GCP service account) ---
router.get('/settings/ad', ...can('settings:read'), settings.getAd);
router.put('/settings/ad', ...can('settings:write'), settings.putAd);
router.post('/settings/ad/test', ...can('settings:write'), settings.testAd);
router.get('/settings/gcp', ...can('settings:read'), settings.getGcp);
router.put('/settings/gcp', ...can('settings:write'), settings.putGcp);
router.post('/settings/gcp/test', ...can('settings:write'), settings.testGcp);

// --- Catálogo GCP ---
router.get('/projects', ...can('catalog:read'), catalog.listProjects);
router.post('/projects', ...can('catalog:write'), catalog.createProject);
router.get('/projects/:id', ...can('catalog:read'), catalog.getProject);
router.put('/projects/:id', ...can('catalog:write'), catalog.updateProject);
router.delete('/projects/:id', ...can('catalog:delete'), catalog.deleteProject);

router.get('/instances', ...can('catalog:read'), catalog.listInstances);
router.post('/instances', ...can('catalog:write'), catalog.createInstance);
router.get('/instances/:id', ...can('catalog:read'), catalog.getInstance);
router.put('/instances/:id', ...can('catalog:write'), catalog.updateInstance);
router.delete('/instances/:id', ...can('catalog:delete'), catalog.deleteInstance);
router.get('/instances/:id/buckets', ...can('catalog:read'), catalog.listInstanceBuckets);
// BDs/usuarios/estado/logins reales de la instancia (Admin API / SQL): para preparar tareas.
router.get('/instances/:id/databases', ...can('tasks:write'), catalog.listInstanceDatabases);
router.get('/instances/:id/users', ...can('tasks:write'), catalog.listInstanceUsers);
router.get('/instances/:id/status', ...can('tasks:write'), catalog.getInstanceStatus);
router.get('/instances/:id/logins', ...can('tasks:write'), catalog.listInstanceLogins);
router.post('/instances/:id/buckets', ...can('catalog:write'), catalog.linkBucket);
router.delete('/instances/:id/buckets/:bucketId', ...can('catalog:write'), catalog.unlinkBucket);
// --- Credenciales SQL (la API nunca devuelve el secreto) ---
router.get('/credentials', ...can('credentials:read'), credentials.list);
router.post('/credentials', ...can('credentials:write'), credentials.create);
router.get('/credentials/:id', ...can('credentials:read'), credentials.get);
router.put('/credentials/:id', ...can('credentials:write'), credentials.update);
router.delete('/credentials/:id', ...can('credentials:write'), credentials.remove);
router.post('/credentials/:id/test', ...can('credentials:write'), credentials.test);
router.post('/instances/:id/test-connection', ...can('credentials:write'), credentials.testInstance);

router.get('/instances/:id/post-scripts', ...can('scripts:read'), postScripts.list);
router.post('/instances/:id/post-scripts', ...can('scripts:write'), postScripts.create);
router.put('/instances/:id/post-scripts/:scriptId', ...can('scripts:write'), postScripts.update);
router.delete('/instances/:id/post-scripts/:scriptId', ...can('scripts:write'), postScripts.remove);
// Scripts pre/post: SQL arbitrario contra la instancia (ejecutar queda en auditoría).
router.post('/instances/:id/post-scripts/:scriptId/run', ...can('scripts:run'), postScripts.run);

router.get('/buckets', ...can('catalog:read'), catalog.listBuckets);
router.post('/buckets', ...can('catalog:write'), catalog.createBucket);
router.get('/buckets/:id', ...can('catalog:read'), catalog.getBucket);
router.put('/buckets/:id', ...can('catalog:write'), catalog.updateBucket);
router.delete('/buckets/:id', ...can('catalog:delete'), catalog.deleteBucket);

// --- Tareas de restore y su programación ---
router.get('/schedules', ...can('tasks:read'), schedule.listSchedules);
router.post('/schedules', ...can('tasks:write'), schedule.createSchedule);
router.get('/schedules/:id', ...can('tasks:read'), schedule.getSchedule);
router.put('/schedules/:id', ...can('tasks:write'), schedule.updateSchedule);
router.delete('/schedules/:id', ...can('tasks:write'), schedule.deleteSchedule);
router.post('/schedules/:id/run', ...can('tasks:run'), schedule.runSchedule);
// Programación de la tarea (none | once | recurring) y vista previa de los backups que tomaría hoy.
router.put('/schedules/:id/schedule', ...can('tasks:schedule'), schedule.setTaskSchedule);
router.get('/schedules/:id/preview', ...can('tasks:write'), schedule.previewSchedule);

// --- Roles y permisos (RBAC) ---
router.get('/permissions', ...can('roles:read'), roles.listPermissions);
router.get('/roles', ...can('roles:read'), roles.listRoles);
router.post('/roles', ...can('roles:write'), roles.createRole);
router.patch('/roles/:id', ...can('roles:write'), roles.updateRole);
router.delete('/roles/:id', ...can('roles:write'), roles.deleteRole);

export default router;
