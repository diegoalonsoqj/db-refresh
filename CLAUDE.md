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
Tablas: `gcp_projects`, `gcp_instances`, `gcp_buckets`, `instance_buckets` (N:N), `instance_post_scripts`, `app_users`, `restore_jobs`, `restore_job_items`, `job_events` (feed SSE), `scheduled_restores`, `audit_log`, `app_settings` (config runtime clave/valor: AD/LDAP y SA de GCP, secreto cifrado at-rest). Ver `db/schema.sql`.

## Módulo de settings (runtime, configurable por API)
AD/LDAP y la service account de GCP ya NO dependen de `.env` fijo: se configuran en caliente y se guardan en `app_settings` (secreto cifrado AES-256-GCM con `APP_ENCRYPTION_KEY`, que sigue en env/Secret Manager). `.env` (`AD_*`, `GOOGLE_APPLICATION_CREDENTIALS`) queda como fallback. Los clientes GCP se construyen bajo demanda y se invalidan al guardar (`server/gcp/state.js` epoch). Rutas: `GET/PUT /api/settings/{ad,gcp}` + `POST .../{ad,gcp}/test`, **protegidas con `authenticate` + `requireRole('admin')`**.
`GET /api/health` (público) devuelve `{ok, db, dbLatencyMs, version, env, uptimeSecs, now}`: alimenta la sección **Sistema** de Ajustes (solo lectura). Si la BD cae responde igual con `db:false`.

## Auth (implementada — híbrida local + AD)
JWT en **cookie httpOnly** (`session`, SameSite=Strict, Secure en prod), TTL = `JWT_EXPIRES_IN`. **Login único** (`POST /api/auth/login` con `{username, password}`; `email` se acepta por compatibilidad): el tipo lo decide el usuario guardado, no el cliente — si lleva `@` se busca por email; si no (o no existe), se normaliza a cuenta AD (`DOMINIO\x` / `x@dominio` → `x`) y se busca por `username`:
- **Local**: argon2id contra `app_users` (`strategies/local.js`).
- **AD/LDAP** (portado de db-keeper, probado allí contra AD real): `auth/ldap.js` (`tryAuthenticateLdap`) con dos modos — **direct** (bind `DOMINIO\usuario` o `usuario@dominio.dns`, sin cuenta de servicio; `searchBase` opcional para leer nombre/correo) y **search** (cuenta de servicio → `userFilter` con `{{username}}` escapado → re-bind con el DN). Cifrado `starttls` (ldap://389) | `ldaps` (ldaps://636) | `none`; `tlsOptions` solo con ldaps:// (con ldap:// el DC corta en el 389). Contraseña vacía = rechazo (bind anónimo).
- **Usuarios AD pre-provisionados** (ya NO auto-alta): un admin los crea en Usuarios (`authSource:'ad'`, `username` normalizado, email opcional, sin password). `strategies/ad.js` solo valida contra el directorio y refresca `full_name`/`email` (si faltaba)/`ad_dn`. `app_users.username` (único, case-insensitive), `email` opcional para AD (`chk_local_email`, `chk_auth_ad`). Fallos de conexión con AD → 401 genérico, motivo `AD_UNAVAILABLE` en `audit_log`.
- **Config AD** (`settings.service`): `app_settings['auth.ad']` = `{enabled, mode, domain, security, url, bindDn, searchBase, userFilter, tlsRejectUnauthorized}` + bind password cifrada; `withAdDefaults` migra configs viejas `{url,baseDn,bindDn}` (→ search). `getAdRuntimeConfig()` = BD o, si no hay fila, env `AD_*` (`AD_MODE/DOMAIN/SECURITY/BASE_DN/BIND_DN/BIND_PASSWORD/USER_FILTER/TLS_REJECT_UNAUTHORIZED`); null si deshabilitado/incompleto. `POST /settings/ad/test` autentica un usuario real con la config guardada.
`GET /api/auth/methods` (público) devuelve `{local, ad}`; el login muestra la ayuda de AD si `ad`. Middleware `authenticate` (cookie o `Bearer`) + `requireRole(...)`. Errores `AuthError`(401)/`ForbiddenError`(403).
**Admin base**: `ensureBaseAdmin()` (`auth/bootstrap.js`) al arrancar la API garantiza un admin local (`BASE_ADMIN_EMAIL`=admin@dbrefresh.local / `BASE_ADMIN_PASSWORD`=P4$$w0rD). Idempotente: crea si falta, **no** resetea el password si ya existe; `BASE_ADMIN_ENABLED=false` lo desactiva. ⚠️ password por defecto conocido → cambiar (pendiente: gestión de usuarios / cambio de password). Seed alternativo: `npm run seed:admin`.

**RBAC por ruta:** `/settings/*` → admin. Lecturas (`GET /backups`, `GET /restores/:id`, SSE) → cualquier autenticado (viewer+). `POST /restores` (destructivo) → operator/admin. **Pendiente:** revocación de sesión.

## Plan por fases
- **Fase 0** — Descubrimiento. ✅ Completada.
- **Fase 1** — Arquitectura + estructura + esquema PG. ✅ Aprobada.
- **Fase 2** — Core backend: capa de datos, interfaz de adaptadores, `SqlServerAdapter` (migra scripts), jobs asíncronos. ✅ Implementada (pendiente prueba contra PG/GCP reales).
- **Fase 3** — `PostgresAdapter` y `MySqlAdapter`. ✅ Implementada (pendiente prueba contra Cloud SQL real).
- **Fase 4** — Frontend React (lanzar, progreso en vivo, historial). ✅ Implementada.
- **Fase 5** — Hardening de seguridad, tests, documentación final. ✅ Hardening + tests (unit+integración) + `README.md`. Pendiente solo lo que requiere infra real (E2E job Cloud SQL, login AD vivo).

## Adaptadores PG/MySQL (Fase 3)
Comparten base `server/engines/sqldump/SqlDumpAdapter.js`; `PostgresAdapter`/`MySqlAdapter` solo especializan `engineLabel`. Importan dumps **SQL** (fileType `SQL`, soporta `.gz`) vía Admin API. Diferencia vs SQL Server: el import de un dump SQL escribe en una BD **existente**, así que el flujo destructivo es **DROP + CREATE (vacía)** — se añadió `csql.createDatabase` (`databases.insert`). Extensiones aceptadas: `.sql`, `.gz`. Asume dump de un único esquema (sin `CREATE DATABASE`/`USE`). Cloud SQL PG **no** soporta formato custom (`pg_dump -Fc`). Post-scripts: no implementados en PG/MySQL — si la instancia tiene scripts activos, el pre-check falla (`POST_SCRIPTS_UNSUPPORTED`) antes de tocar nada.

## Pre-check y post-scripts (SQL Server)
Flujo de `runJob`: **pre-check** → (por item: re-chequeo de instancia libre si no es el 1º → drop → import) → post-scripts.
- **Pre-check** (antes del primer DROP; si falla, job e items `failed` sin tocar ninguna BD): `validateBackup` de **todos** los items, `adapter.preflight()` = `waitInstanceIdle` (`csql.waitForInstanceIdle`: `operations.list`, PENDING/RUNNING; espera hasta `INSTANCE_IDLE_WAIT_SECONDS`=900 y lanza `INSTANCE_BUSY`) + `verifyPostScriptsConnection()` si hay scripts activos (SQL Server: login + `SELECT 1` en master).
- **Post-scripts**: tabla `instance_post_scripts` (por instancia, `sort_order`, `database_name` opcional → default master, `sql_text` con lotes `GO`, `is_active`). CRUD `/api/instances/:id/post-scripts` **solo admin** (también lectura: SQL arbitrario/sensible). UI: botón "Post-scripts" en Catálogo → Instancias. Se ejecutan solo si todos los items OK; `SqlServerAdapter.runPostScripts` vía `mssql` (`engines/sqlserver/mssql.client.js`, encrypt+trustServerCertificate como el original), `splitSqlBatches` (`lib/sqlBatches.js`), los `PRINT` van al log del job. **Diferencia vs original: el primer fallo detiene el resto** y deja el job `failed`.
- **`secret_ref`** (password del admin de la instancia) se resuelve en `lib/secrets.js`: `sm://projects/<p>/secrets/<s>[/versions/<v>]` (Secret Manager por REST con la SA de settings; necesita `secretAccessor`) o `env:NOMBRE` (dev). Nunca se loguea.

## Catálogo/Bucket CRUD + Scheduler
**CRUD** de `gcp_projects`, `gcp_instances`, `gcp_buckets` y N:N `instance_buckets` en `catalog.repo`/`catalog.service`/`catalog.controller`. Rutas REST `/api/{projects,instances,buckets}` (+`/instances/:id/buckets` para vincular). RBAC: **lecturas → autenticado, escrituras → admin**. Errores de integridad PG traducidos a `ConflictError`(409) vía `data/pgErrors.js` (23505 duplicado, 23503 en uso). Validación en `lib/validation.js` (`assertNonEmpty/SafeName/OneOf`).
**Scheduler** in-app (`server/jobs/scheduler.js`, `npm run scheduler`): proceso aparte con `node-cron` que reconcilia `scheduled_restores` activas cada 30s (alta/baja/cambio) y encola `restore_jobs` vía `schedule.service.triggerSchedule` (reutiliza `restore.service.launchRestore`; el worker es el único ejecutor). `mapping` jsonb = `[{backupFile,targetDb}]`. CRUD en `/api/schedules` (+`/:id/run` dispara ya). RBAC schedules: **lecturas → autenticado, escrituras/run → operator|admin**. Pendiente: cálculo de `next_run_at`.

## Frontend (Fase 4)
`web/` React 18 + Vite 6, CSS propio (sin framework), `react-router-dom`. Dev: `npm --prefix web run dev` (:5173, proxya `/api`→la API para cookie same-origin; el target lo deriva del `PORT` del `.env` de la raíz vía `loadEnv`, default 3004). Base: `api/client.js` (fetch `credentials:'include'`), `auth/` (AuthContext + `RequireAuth` guard por rol), `hooks/useList.js`, `components/` (Layout, StatusBadge, Modal). Backend: añadido `GET /api/restores` (listar jobs).
**Pantallas:** Login; Historial (`/jobs`); Detalle (`/jobs/:id`, items + log SSE en vivo); Lanzar restore (`/launch`, operator+). **UI admin:** Programadas (`/schedules`, operator+: CRUD + editor de mapping + ejecutar-ya); Catálogo (`/catalog`, admin: tabs Proyectos/Instancias/Buckets con CRUD + modal de vínculo N:N instancia-bucket con default); Ajustes (`/settings`, admin). Nav condicionada por rol.

### Convenciones de UI (alineadas con `db-keeper` y `db-profiler`)
Esos dos proyectos (en `D:\DEVS\`) son la **referencia visual**; al tocar layout/UI, copiar su patrón:
- **Shell**: sidebar colapsable con toggle **circular montado a caballo del borde derecho** (abajo; chevron que rota 180°), estado persistido en `localStorage` (`dbrefresh.sidebarCollapsed`). `.app` es `height:100vh; overflow:hidden`: el header queda fijo y scrollea solo `.app-main`.
- **Header**: `.app-header` (56px, misma altura que `.sidebar-head`) con el **usuario arriba a la derecha** (`UserMenu`: avatar con iniciales + nombre + rol; desplegable con email, cambiar contraseña y cerrar sesión; cierra con click fuera o Escape).
- **Ajustes**: `settings-layout` = **nav vertical de secciones** + card por sección, con **punto de estado** por sección (verde = configurada). Campos con `label` + `hint`.

## Hardening de seguridad (Fase 5)
- **Cabeceras**: `helmet` (CSP, HSTS, nosniff, X-Frame-Options SAMEORIGIN), `x-powered-by` off, `trust proxy` configurable (ver abajo), límite de body JSON `256kb`. `errorHandler` respeta el status HTTP de errores no-AppError (p.ej. body-parser → 413).
- **Exposición HTTP** (`config.http`, `lib/http.js`): `HTTPS_ENABLED` (default = production) gobierna cookie `Secure` + HSTS + CSP `upgrade-insecure-requests` (+COOP); `TRUST_PROXY` (default 1; `false` si la API está expuesta directa, si no XFF falsea `req.ip` y se salta el rate-limit). Express sirve `web/dist` si existe (`SERVE_WEB`, assets inmutables, fallback SPA; `/api/*` desconocido → 404 JSON). **1ª etapa prod: VPS por IP:puerto sin TLS** → `HTTPS_ENABLED=false`, `TRUST_PROXY=false`, PM2 con `ecosystem.config.cjs` (api/worker/scheduler, autorestart, VPS 4 GB → 2 GB total app: api 1G/heap 768, worker 768M/heap 576, scheduler 256M/heap 192, worker `kill_timeout` 15min, `pm2 save`+`pm2 startup`).
- **Rate-limit**: `express-rate-limit` en `POST /auth/login` (10 fallos/15min por IP, `skipSuccessfulRequests`). `server/middleware/rateLimit.js`.
- **Gestión de usuarios (admin)**: `/api/users` CRUD (`users.service`/`users.controller`), `PATCH` rol/estado, `POST /:id/reset-password`, con auto-protección (un admin no puede degradarse/desactivarse/eliminarse). Cambio propio: `POST /auth/change-password` (verifica el actual). Password mín. 10. Solo usuarios locales para password (AD se gestiona en el directorio).
- **Auditoría**: tabla `audit_log` poblada por `middleware/audit.js` (toda mutación POST/PUT/PATCH/DELETE, tras responder, con actor/ip/status; NO registra bodies) + login/login_failed/change_password explícitos en el controlador. Consulta `GET /api/audit` (admin). Helper `lib/audit.js` (fire-and-forget). FKs a `app_users` (`audit_log.actor`, `restore_jobs.requested_by`, `scheduled_restores.created_by`, `app_settings.updated_by`) → **ON DELETE SET NULL** (borrar un usuario conserva su historial). Frontend: páginas Usuarios y Auditoría (admin) + modal "cambiar contraseña".
- **Secretos/repo**: `.gitignore` cubre `.env`, `**/Keys/`, `secrets/`, `*-sa.json`, etc. Sin commits ni nada sensible trackeado; la SA real en `MODELO_HOMOLOGACIONES/Keys/` está ignorada.

## Tests (Fase 5)
`npm test` (= `node --test`, runner nativo, 0 deps extra). **45 tests en verde** (incl. `test/postscripts.test.js`: lotes GO, secret_ref, operaciones en curso, adaptador sin soporte; e integración CRUD post-scripts):
- **20 unitarios** (`test/*.test.js`, funciones puras sin BD/red): `crypto` (roundtrip/tamper GCM), `validation` (SAFE_NAME/assert*), `errors` (status HTTP), `jwt` (sign/verify/manipulación), `password` (argon2id), `gcs` (parseGsUri), `ldap` (escapeFilter anti-inyección). Env aislado en `test-support/env.js` (importado 1º; no se descubre como test).
- **8 de integración/E2E** (`test/integration/api.test.js`): levantan la app real (`createApp()` de `server/app.js`, extraído de `index.js`) en puerto efímero y la ejercitan por HTTP contra la BD real — auth (methods/login/me/401), RBAC (viewer→403 en restore y projects), header helmet, CRUD de catálogo (201/list/409/204). Siembran/limpian sus datos (`itest-*`); **auto-skip si no hay BD** (probe `SELECT 1`), así `npm test` no falla sin PostgreSQL. Usan el `.env` real (no `test-support/env.js`).
**Falta**: cobertura del flujo de restore con GCP mockeado (worker/adaptadores).

## Estado actual
Backend + frontend completos, con hardening (headers, rate-limit, gestión de usuarios, auditoría, secretos) y **tests unitarios (20 ✓)**. `npm install` (raíz y `web/`) + `npm run migrate` OK; `web` compila (`vite build`, 52 módulos). Verificado E2E por HTTP: auth híbrida local+AD, RBAC, settings, catálogo CRUD, schedules+scheduler, y todo el hardening (helmet headers, 413 body-limit, rate-limit 429, users CRUD + auto-protección, change-password, auditoría con FK SET NULL).
Documentación: **`README.md`** (instalación/config/ejecución/API/tests/despliegue).
**Dev runner:** `npm run dev:all` (`scripts/dev.js`, Node puro sin deps) levanta API+worker+scheduler+web en una terminal (salida prefijada, Ctrl+C mata el árbol con `taskkill /T` en Windows, fail-fast si un servicio cae); admite subconjunto (`node scripts/dev.js api web`). **Puerto de la API: 3004** — `vite.config.js` lo lee del `.env` de la raíz, así proxy y API no se desalinean.
Pendiente para cerrar (requiere infra real del usuario): **prueba E2E de un job real contra Cloud SQL** (camino GCP de adaptadores sin ejercitar contra infra real) y **login AD contra un directorio real** (cableado verificado, no probado contra AD vivo). Post-scripts PG/MySQL. Menor: `next_run_at`, revocación de sesión (denylist de JWT), test del flujo de restore con GCP mockeado.
</content>
</invoke>
