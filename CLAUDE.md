# CLAUDE.md — db-refresh

Fuente de verdad del proyecto. Actualizar al cerrar cada fase. No repetir su contenido en cada respuesta.

## Objetivo
Sistema web para **orquestar la restauración de backups en Cloud SQL de GCP**, soportando 3 motores destino: **SQL Server, PostgreSQL, MySQL**. Reemplaza los scripts Python actuales en `MODELO_HOMOLOGACIONES/` (referencia, NO se modifican).

## Stack (fijo)
- Runtime: **Node.js 24 LTS**, JavaScript **ESM** (sin TypeScript).
- Backend: **Express**.
- BD de la app: **PostgreSQL 17** (metadata, historial, config, usuarios, auditoría).
- Frontend: **React + Vite**.
- GCP: **Cloud SQL Admin API** (`@googleapis/sqladmin`), **GCS** (`@google-cloud/storage`), auth por Service Account / IAM.

## Decisiones de arquitectura (congeladas — Fase 1)
- **D1 — SDK Admin API, no `gcloud` CLI.** import → `instances.import` (fileType BAK|SQL, soporta `.gz`); drop → `databases.delete`; polling → `operations.get`. Post-scripts SQL (p.ej. `sp_start_job`) requieren cliente SQL real (`mssql`/`pg`/`mysql2`), el Admin API no ejecuta SQL arbitrario.
- **D2 — Jobs asíncronos en PostgreSQL** (tabla `restore_jobs` + worker con `FOR UPDATE SKIP LOCKED`), sin Redis. Progreso en vivo por **SSE**.
- **D3 — Patrón Strategy/Adapter por motor.** Interfaz `EngineAdapter`: `listBackups`, `validateBackup`, `prepareTarget` (drop destructivo), `restore`, `getOperationStatus`. Implementaciones `SqlServerAdapter`, `PostgresAdapter`, `MySqlAdapter`.
- **Flujo destructivo uniforme:** en los 3 motores se elimina la BD existente antes de restaurar.
- **D4 — Secretos** fuera del repo: Secret Manager en prod, `.env` en dev. `.env` y `Keys/` en `.gitignore`. Consultas SQL siempre parametrizadas.
- **Scheduling in-app** (tabla `scheduled_restores` + `node-cron`), reemplaza el crontab del SO. El scheduler encola `restore_jobs`; el worker es el único camino de ejecución.
- **Auth híbrida**: local (`argon2`) + AD/LDAP (`ldapts`), sesión por **JWT**. RBAC: admin | operator | viewer.
- **Buckets**: catálogo CRUD, N buckets por proyecto, N:N con instancias.

## Capas
rutas → controladores (thin) → servicios → adaptadores de motor → capa de datos (repositorios, queries parametrizadas). Sin lógica de negocio en controladores. Errores de dominio vs infraestructura. Logging estructurado (pino).

## Estructura
```
db/                  migraciones + schema.sql consolidado
server/
  config/            carga y validación de env + Secret Manager
  routes/            endpoints (thin)
  controllers/       req/res -> servicios
  services/          restore, backup, catalog, bucket, schedule
  engines/           EngineAdapter + sqlserver/ postgres/ mysql/
  jobs/              worker (SKIP LOCKED), scheduler (cron), progress (SSE)
  gcp/               storage.client, cloudsql.client (Admin API)
  data/              pool + repositories/
  domain/            errors.js
  auth/              strategies/{local,ad} + middleware (JWT + RBAC)
  lib/               logger.js
web/                 React + Vite
MODELO_HOMOLOGACIONES/  scripts originales (referencia, NO tocar)
```

## Modelo de datos (PostgreSQL 17)
Enums: `engine_type`, `job_status`, `item_status`, `auth_source`.
Tablas: `gcp_projects`, `gcp_instances`, `gcp_buckets`, `instance_buckets` (N:N), `app_users`, `restore_jobs`, `restore_job_items`, `job_events` (feed SSE), `scheduled_restores`, `audit_log`, `app_settings` (config runtime clave/valor: AD/LDAP y SA de GCP, secreto cifrado at-rest). Ver `db/schema.sql`.

## Módulo de settings (runtime, configurable por API)
AD/LDAP y la service account de GCP ya NO dependen de `.env` fijo: se configuran en caliente y se guardan en `app_settings` (secreto cifrado AES-256-GCM con `APP_ENCRYPTION_KEY`, que sigue en env/Secret Manager). `.env` (`AD_*`, `GOOGLE_APPLICATION_CREDENTIALS`) queda como fallback. Los clientes GCP se construyen bajo demanda y se invalidan al guardar (`server/gcp/state.js` epoch). Rutas: `GET/PUT /api/settings/{ad,gcp}` + `POST .../{ad,gcp}/test`, **protegidas con `authenticate` + `requireRole('admin')`**.

## Auth (implementada — híbrida local + AD)
JWT en **cookie httpOnly** (`session`, SameSite=Strict, Secure en prod), TTL = `JWT_EXPIRES_IN`. **Login híbrido** (`POST /api/auth/login` con `source: local|ad`):
- **Local**: argon2id contra `app_users` (`strategies/local.js`).
- **AD/LDAP**: `strategies/ad.js` — toma la conexión del **módulo de settings** (`getAdCredentials`, no de env): bind de servicio → search (sAMAccountName/UPN/mail, filtro escapado) → bind del usuario → upsert en `app_users` (`auth_source='ad'`, `ad_dn`, rol inicial `AD_DEFAULT_ROLE`=viewer, luego editable). `getAdCredentials` cae a env si no hay settings.
`GET /api/auth/methods` (público) indica qué fuentes hay (`{local, ad}`) para que el login muestre la pestaña AD solo si está configurada. Middleware `authenticate` (cookie o `Bearer`) + `requireRole(...)`. Errores `AuthError`(401)/`ForbiddenError`(403).
**Admin base**: `ensureBaseAdmin()` (`auth/bootstrap.js`) al arrancar la API garantiza un admin local (`BASE_ADMIN_EMAIL`=admin@dbrefresh.local / `BASE_ADMIN_PASSWORD`=P4$$w0rD). Idempotente: crea si falta, **no** resetea el password si ya existe; `BASE_ADMIN_ENABLED=false` lo desactiva. ⚠️ password por defecto conocido → cambiar (pendiente: gestión de usuarios / cambio de password). Seed alternativo: `npm run seed:admin`.

**RBAC por ruta:** `/settings/*` → admin. Lecturas (`GET /backups`, `GET /restores/:id`, SSE) → cualquier autenticado (viewer+). `POST /restores` (destructivo) → operator/admin. **Pendiente:** completar login AD; hardening (rate-limit login, revocación de sesión).

## Plan por fases
- **Fase 0** — Descubrimiento. ✅ Completada.
- **Fase 1** — Arquitectura + estructura + esquema PG. ✅ Aprobada.
- **Fase 2** — Core backend: capa de datos, interfaz de adaptadores, `SqlServerAdapter` (migra scripts), jobs asíncronos. ✅ Implementada (pendiente prueba contra PG/GCP reales).
- **Fase 3** — `PostgresAdapter` y `MySqlAdapter`. ✅ Implementada (pendiente prueba contra Cloud SQL real).
- **Fase 4** — Frontend React (lanzar, progreso en vivo, historial). ✅ Implementada.
- **Fase 5** — Hardening de seguridad, tests, documentación final. ✅ Hardening + tests (unit+integración) + `README.md`. Pendiente solo lo que requiere infra real (E2E job Cloud SQL, login AD vivo).

## Adaptadores PG/MySQL (Fase 3)
Comparten base `server/engines/sqldump/SqlDumpAdapter.js`; `PostgresAdapter`/`MySqlAdapter` solo especializan `engineLabel`. Importan dumps **SQL** (fileType `SQL`, soporta `.gz`) vía Admin API. Diferencia vs SQL Server: el import de un dump SQL escribe en una BD **existente**, así que el flujo destructivo es **DROP + CREATE (vacía)** — se añadió `csql.createDatabase` (`databases.insert`). Extensiones aceptadas: `.sql`, `.gz`. Asume dump de un único esquema (sin `CREATE DATABASE`/`USE`). Cloud SQL PG **no** soporta formato custom (`pg_dump -Fc`). Post-scripts de owner/permisos: hook `runPostScripts` pendiente (requiere cliente `pg`/`mysql2` real).

## Catálogo/Bucket CRUD + Scheduler
**CRUD** de `gcp_projects`, `gcp_instances`, `gcp_buckets` y N:N `instance_buckets` en `catalog.repo`/`catalog.service`/`catalog.controller`. Rutas REST `/api/{projects,instances,buckets}` (+`/instances/:id/buckets` para vincular). RBAC: **lecturas → autenticado, escrituras → admin**. Errores de integridad PG traducidos a `ConflictError`(409) vía `data/pgErrors.js` (23505 duplicado, 23503 en uso). Validación en `lib/validation.js` (`assertNonEmpty/SafeName/OneOf`).
**Scheduler** in-app (`server/jobs/scheduler.js`, `npm run scheduler`): proceso aparte con `node-cron` que reconcilia `scheduled_restores` activas cada 30s (alta/baja/cambio) y encola `restore_jobs` vía `schedule.service.triggerSchedule` (reutiliza `restore.service.launchRestore`; el worker es el único ejecutor). `mapping` jsonb = `[{backupFile,targetDb}]`. CRUD en `/api/schedules` (+`/:id/run` dispara ya). RBAC schedules: **lecturas → autenticado, escrituras/run → operator|admin**. Pendiente: cálculo de `next_run_at`.

## Frontend (Fase 4)
`web/` React 18 + Vite 6, CSS propio (sin framework), `react-router-dom`. Dev: `npm --prefix web run dev` (:5173, proxya `/api`→:5000 para cookie same-origin). Base: `api/client.js` (fetch `credentials:'include'`), `auth/` (AuthContext + `RequireAuth` guard por rol), `hooks/useList.js`, `components/` (Layout, StatusBadge, Modal). Backend: añadido `GET /api/restores` (listar jobs).
**Pantallas:** Login; Historial (`/jobs`); Detalle (`/jobs/:id`, items + log SSE en vivo); Lanzar restore (`/launch`, operator+). **UI admin:** Programadas (`/schedules`, operator+: CRUD + editor de mapping + ejecutar-ya); Catálogo (`/catalog`, admin: tabs Proyectos/Instancias/Buckets con CRUD + modal de vínculo N:N instancia-bucket con default); Ajustes (`/settings`, admin: form AD + subir/pegar JSON de SA GCP, ambos con "probar conexión"). Nav condicionada por rol.

## Hardening de seguridad (Fase 5)
- **Cabeceras**: `helmet` (CSP, HSTS, nosniff, X-Frame-Options SAMEORIGIN), `x-powered-by` off, `trust proxy=1`, límite de body JSON `256kb`. `errorHandler` respeta el status HTTP de errores no-AppError (p.ej. body-parser → 413).
- **Rate-limit**: `express-rate-limit` en `POST /auth/login` (10 fallos/15min por IP, `skipSuccessfulRequests`). `server/middleware/rateLimit.js`.
- **Gestión de usuarios (admin)**: `/api/users` CRUD (`users.service`/`users.controller`), `PATCH` rol/estado, `POST /:id/reset-password`, con auto-protección (un admin no puede degradarse/desactivarse/eliminarse). Cambio propio: `POST /auth/change-password` (verifica el actual). Password mín. 10. Solo usuarios locales para password (AD se gestiona en el directorio).
- **Auditoría**: tabla `audit_log` poblada por `middleware/audit.js` (toda mutación POST/PUT/PATCH/DELETE, tras responder, con actor/ip/status; NO registra bodies) + login/login_failed/change_password explícitos en el controlador. Consulta `GET /api/audit` (admin). Helper `lib/audit.js` (fire-and-forget). FKs a `app_users` (`audit_log.actor`, `restore_jobs.requested_by`, `scheduled_restores.created_by`, `app_settings.updated_by`) → **ON DELETE SET NULL** (borrar un usuario conserva su historial). Frontend: páginas Usuarios y Auditoría (admin) + modal "cambiar contraseña".
- **Secretos/repo**: `.gitignore` cubre `.env`, `**/Keys/`, `secrets/`, `*-sa.json`, etc. Sin commits ni nada sensible trackeado; la SA real en `MODELO_HOMOLOGACIONES/Keys/` está ignorada.

## Tests (Fase 5)
`npm test` (= `node --test`, runner nativo, 0 deps extra). **28 tests en verde**:
- **20 unitarios** (`test/*.test.js`, funciones puras sin BD/red): `crypto` (roundtrip/tamper GCM), `validation` (SAFE_NAME/assert*), `errors` (status HTTP), `jwt` (sign/verify/manipulación), `password` (argon2id), `gcs` (parseGsUri), `ldap` (escapeFilter anti-inyección). Env aislado en `test-support/env.js` (importado 1º; no se descubre como test).
- **8 de integración/E2E** (`test/integration/api.test.js`): levantan la app real (`createApp()` de `server/app.js`, extraído de `index.js`) en puerto efímero y la ejercitan por HTTP contra la BD real — auth (methods/login/me/401), RBAC (viewer→403 en restore y projects), header helmet, CRUD de catálogo (201/list/409/204). Siembran/limpian sus datos (`itest-*`); **auto-skip si no hay BD** (probe `SELECT 1`), así `npm test` no falla sin PostgreSQL. Usan el `.env` real (no `test-support/env.js`).
**Falta**: cobertura del flujo de restore con GCP mockeado (worker/adaptadores).

## Estado actual
Backend + frontend completos, con hardening (headers, rate-limit, gestión de usuarios, auditoría, secretos) y **tests unitarios (20 ✓)**. `npm install` (raíz y `web/`) + `npm run migrate` OK; `web` compila (`vite build`, 52 módulos). Verificado E2E por HTTP: auth híbrida local+AD, RBAC, settings, catálogo CRUD, schedules+scheduler, y todo el hardening (helmet headers, 413 body-limit, rate-limit 429, users CRUD + auto-protección, change-password, auditoría con FK SET NULL).
Documentación: **`README.md`** (instalación/config/ejecución/API/tests/despliegue). Se alineó `PORT=5000` en `.env.example` con el proxy de Vite.
Pendiente para cerrar (requiere infra real del usuario): **prueba E2E de un job real contra Cloud SQL** (camino GCP de adaptadores sin ejercitar contra infra real) y **login AD contra un directorio real** (cableado verificado, no probado contra AD vivo). Menor: `next_run_at`, revocación de sesión (denylist de JWT), test del flujo de restore con GCP mockeado.
</content>
</invoke>
