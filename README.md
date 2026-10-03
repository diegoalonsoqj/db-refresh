# db-refresh

Sistema web para **orquestar la restauración de backups en Cloud SQL de GCP**, con soporte para tres motores destino: **SQL Server, PostgreSQL y MySQL**. Reemplaza los scripts Python de `MODELO_HOMOLOGACIONES/` (que quedan solo como referencia).

> Este README es la guía de instalación y operación.

---

## Características

- **Restauración multi-motor** vía **Cloud SQL Admin API** (sin `gcloud` CLI): SQL Server (`.bak`), PostgreSQL / MySQL (dumps `.sql`/`.gz`).
- **Flujo destructivo uniforme**: se elimina la BD destino antes de restaurar (en PG/MySQL se recrea vacía antes del import).
- **Pre-check antes de borrar nada**: valida que existan todos los backups, espera a que la instancia no tenga operaciones en curso (backup automático, otro import) y prueba la conexión para post-scripts. Si falla, el job termina sin tocar ninguna BD.
- **Post-scripts SQL por instancia** (SQL Server): se ejecutan en orden tras un job 100% OK (p. ej. `sp_start_job`), con lotes `GO` y los `PRINT` en el log del job.
- **Jobs asíncronos** en PostgreSQL (`FOR UPDATE SKIP LOCKED`) con un **worker** independiente y **progreso en vivo por SSE**.
- **Programación in-app** (scheduler con `node-cron`), reemplaza el crontab del SO.
- **Catálogo** de proyectos, instancias y buckets (N:N) administrable por UI/API.
- **Módulo de settings**: configura AD/LDAP y sube el JSON de la service account de GCP en caliente (cifrados en la BD).
- **Auth híbrida**: local (argon2id) + AD/LDAP (usuarios AD dados de alta por un admin; bind directo `DOMINIO\usuario` o cuenta de servicio; StartTLS/LDAPS), login único, sesión por **JWT en cookie httpOnly**, **RBAC** (admin / operator / viewer).
- **Hardening**: helmet, rate-limit de login, auditoría, gestión de usuarios, secretos fuera del repo.
- **Frontend** React + Vite.

## Stack

| | |
|---|---|
| Runtime | **Node.js 24 LTS**, JavaScript ESM (sin TypeScript) |
| Backend | **Express** |
| BD de la app | **PostgreSQL 17** (metadata, jobs, usuarios, auditoría, settings) |
| Frontend | **React 18 + Vite 6** |
| GCP | Cloud SQL Admin API (`@googleapis/sqladmin`), GCS (`@google-cloud/storage`) |
| Auth | `argon2`, `ldapts`, `jsonwebtoken` |

## Arquitectura

**Capas** (backend): rutas → controladores (thin) → servicios → adaptadores de motor → capa de datos (repositorios, queries parametrizadas).

**Procesos** (se ejecutan por separado):
- **API** (`npm start`) — sirve `/api`.
- **Worker** (`npm run worker`) — toma jobs pendientes y los ejecuta.
- **Scheduler** (`npm run scheduler`) — encola jobs según `scheduled_restores`.

**Adaptadores por motor** (patrón Strategy): `SqlServerAdapter`, `PostgresAdapter`, `MySqlAdapter` (estos dos sobre una base `SqlDumpAdapter`).

---

## Requisitos

- **Node.js ≥ 24**
- **PostgreSQL 17** accesible (BD de la aplicación)
- Credenciales de **GCP** (service account con permisos de Cloud SQL Admin y GCS) — se cargan por el módulo de settings o por `GOOGLE_APPLICATION_CREDENTIALS`.

## Instalación

```bash
# 1. Dependencias del backend
npm install

# 2. Dependencias del frontend
npm --prefix web install

# 3. Configuración
cp .env.example .env      # y edita los valores (ver tabla abajo)

# 4. Esquema de la BD (idempotente)
npm run migrate
```

### Genera los secretos requeridos

```bash
# Clave maestra para cifrar settings (AES-256-GCM)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # -> APP_ENCRYPTION_KEY
# Secreto del JWT
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"   # -> JWT_SECRET
```

## Configuración (`.env`)

| Variable | Descripción | Por defecto |
|---|---|---|
| `NODE_ENV` | `development` \| `production` | `development` |
| `PORT` | Puerto de la API (el proxy de Vite en dev lo lee de aquí) | `3004` |
| `LOG_LEVEL` | Nivel de log (pino) | `info` |
| `APP_DB_HOST/PORT/NAME/USER/PASSWORD` | Conexión a la BD de la app | — |
| `APP_DB_POOL_MAX` | Máx. conexiones del pool | `10` |
| `JWT_SECRET` | Secreto de firma del JWT (**obligatorio**) | — |
| `JWT_EXPIRES_IN` | TTL de sesión (`8h`, `30m`, `7d`…) | `8h` |
| `APP_ENCRYPTION_KEY` | Clave maestra para cifrar settings (**obligatoria** si usas AD/GCP por UI) | — |
| `BASE_ADMIN_ENABLED` | Crear admin base al arrancar | `true` |
| `BASE_ADMIN_EMAIL` | Email del admin base | `admin@dbrefresh.local` |
| `BASE_ADMIN_PASSWORD` | Password inicial del admin base | `P4$$w0rD` |
| `AD_URL`, `AD_MODE`, `AD_DOMAIN`, `AD_SECURITY`, `AD_BASE_DN`, `AD_BIND_DN`, `AD_BIND_PASSWORD`, `AD_USER_FILTER`, `AD_TLS_REJECT_UNAUTHORIZED` | Fallback de AD si no hay config en Ajustes (ver `.env.example`) | — |
| `AD_URL/AD_BASE_DN/AD_BIND_DN/AD_BIND_PASSWORD` | Fallback de AD (preferir el módulo de settings) | — |
| `GOOGLE_APPLICATION_CREDENTIALS` | Fallback de la SA (preferir el módulo de settings) | — |
| `WORKER_ID` | Id del worker | `worker-<pid>` |
| `WORKER_POLL_INTERVAL_MS` | Sondeo de jobs | `5000` |
| `OPERATION_TIMEOUT_SECONDS` | Timeout de operaciones GCP | `10800` |
| `OPERATION_POLL_INTERVAL_SECONDS` | Sondeo de operaciones GCP | `30` |
| `INSTANCE_IDLE_WAIT_SECONDS` | Pre-check: espera máxima a que la instancia quede libre de operaciones | `900` |
| `POST_SCRIPT_TIMEOUT_MS` | Timeout por lote `GO` de un post-script | `600000` |

> **Secretos**: `.env`, `**/Keys/`, `secrets/` y patrones de SA están en `.gitignore`. Nunca commitees credenciales. En producción usa **Secret Manager**.

---

## Ejecución

### Desarrollo

```bash
npm run dev:all             # API + worker + scheduler + frontend en una terminal
```

O cada proceso por separado, si prefieres una terminal por servicio:

```bash
npm run dev                 # API con --watch (:3004, el proxy de Vite apunta ahí)
npm run worker              # worker de jobs (otra terminal)
npm run scheduler           # scheduler (opcional, otra terminal)
npm --prefix web run dev    # frontend en :5173 (proxya /api -> la API)
```

`dev:all` acepta un subconjunto: `node scripts/dev.js api web`.

Abre **http://localhost:5173**.

### Producción (PM2)

`ecosystem.config.cjs` define 3 procesos (`db-refresh-api`, `db-refresh-worker`, `db-refresh-scheduler`) con autorestart, tope de **2 GB por proceso** (`max_memory_restart: 2G`, heap V8 en 1792 MB para que el GC actúe antes) y logs en `logs/`.

```bash
npm install -g pm2
npm --prefix web run build                      # genera web/dist (servir con Nginx/CDN)
pm2 start ecosystem.config.cjs --env production
pm2 save                                        # guarda la lista de procesos
pm2 startup                                     # una vez: ejecuta el comando que imprime (systemd) -> arranca al reiniciar el host
```

En Windows `pm2 startup` no está soportado: registrar PM2 como servicio con `pm2-installer` (o `pm2-windows-startup`) y luego `pm2 save`. Tras cambiar el ecosystem: `pm2 reload ecosystem.config.cjs --env production && pm2 save`. El worker tiene `kill_timeout` de 15 min: un `reload/stop` espera a que termine el restore en curso.

En producción: servir tras **HTTPS** (la cookie de sesión usa `Secure`), un **reverse proxy** delante de la API, y los secretos desde **Secret Manager**.

## Primer acceso

Al arrancar la API se garantiza un **admin base** (idempotente):

```
usuario: admin@dbrefresh.local
clave:   P4$$w0rD
```

> ⚠️ **Cambia esa contraseña de inmediato** (botón "Contraseña" en la barra superior o en Ajustes → Usuarios). También puedes crear tu propio admin con `npm run seed:admin` (vars `ADMIN_EMAIL`/`ADMIN_PASSWORD`).

### Configurar GCP y AD (como admin)

1. **Ajustes → GCP Service Account**: sube el JSON de la SA o pégalo, y "Probar credenciales".
2. **Ajustes → AD/LDAP** (opcional): habilita AD, elige el modo (**bind directo** con el dominio, sin cuenta de servicio, o **cuenta de servicio + búsqueda**), el cifrado (StartTLS recomendado / LDAPS / ninguno) y la URL; guarda y usa **Probar AD** con un usuario real. Lo guardado tiene prioridad sobre las variables `AD_*` del `.env`.
3. **Usuarios → Nuevo usuario → tipo Active Directory**: da de alta la cuenta de red (`DOMINIO\usuario` o `usuario`, se guarda sin dominio) y su rol. Solo los usuarios AD dados de alta pueden entrar; nombre y correo se completan desde AD al iniciar sesión. El login es único: email (local) o usuario de red (AD).

## Flujo de uso

1. **Catálogo** (admin): crea *Proyecto* → *Instancia* (motor, host, usuario admin, `secret_ref`) → *Bucket*, y **vincula** el bucket a la instancia. Opcional: **Post-scripts** de la instancia (SQL a ejecutar tras restaurar).
   - `secret_ref` es una **referencia** al password del usuario admin, nunca el password: `sm://projects/<p>/secrets/<s>[/versions/<v>]` (Secret Manager, leído con la SA de Ajustes, que necesita `Secret Manager Secret Accessor`) o `env:NOMBRE` (variable de entorno, para dev). Solo se usa para los post-scripts.
2. **Lanzar restore** (operator/admin): elige instancia → bucket → *Listar backups* → mapea cada backup a su BD destino → **Restaurar**.
3. **Progreso en vivo**: el detalle del job muestra el estado por BD y el **log en tiempo real (SSE)**.
4. **Historial**: lista de jobs con su estado.
5. **Programadas** (operator/admin): define un cron + mapping; el scheduler encola el job automáticamente (o "Ejecutar ya").

---

## Seguridad

- **Sesión**: JWT en **cookie httpOnly** (`SameSite=Strict`, `Secure` en prod).
- **RBAC**: `admin` (todo, incl. catálogo/usuarios/ajustes), `operator` (lanzar/programar restores), `viewer` (solo lectura).
- **Rate-limit** en `/auth/login` (10 fallos/15 min por IP).
- **Auditoría**: toda mutación + login/cambios se registran en `audit_log` (consulta en *Auditoría*).
- **Secretos**: cifrados en la BD (AES-256-GCM) con `APP_ENCRYPTION_KEY`; nunca se devuelven por la API. Cabeceras vía **helmet**.

## API (resumen)

Base: `/api`. Todo salvo `health`, `auth/methods`, `auth/login` requiere sesión.

| Área | Endpoints |
|---|---|
| Auth | `GET auth/methods`, `POST auth/login`, `POST auth/logout`, `GET auth/me`, `POST auth/change-password` |
| Usuarios (admin) | `GET/POST users`, `PATCH users/:id`, `POST users/:id/reset-password`, `DELETE users/:id`, `GET audit` |
| Backups / Restores | `GET backups`, `GET/POST restores`, `GET restores/:id`, `GET restores/:id/events` (SSE) |
| Settings (admin) | `GET/PUT settings/ad`, `POST settings/ad/test`, `GET/PUT settings/gcp`, `POST settings/gcp/test` |
| Catálogo | `projects`, `instances` (+ `instances/:id/buckets`), `buckets` (lecturas: autenticado; escrituras: admin) |
| Post-scripts | `instances/:id/post-scripts` (+ `/:scriptId`) — CRUD, **solo admin** (también lectura: es SQL arbitrario) |
| Schedules (operator+) | `GET/POST schedules`, `GET/PUT/DELETE schedules/:id`, `POST schedules/:id/run` |

## Tests

```bash
npm test
```

- **Unitarios** (`test/*.test.js`): funciones puras (cifrado, validación, JWT, argon2, parseo GCS, escape LDAP, lotes `GO`, `secret_ref`, filtro de operaciones en curso). No requieren BD.
- **Integración/E2E** (`test/integration/`): levantan la app real y la prueban por HTTP contra la BD (auth, RBAC, headers, CRUD). Se **saltan** si no hay PostgreSQL disponible.

## Estructura del repositorio

```
db/                  migraciones + schema.sql consolidado + seed-admin
server/
  app.js             construcción de la app Express (sin listen)
  index.js           bootstrap (admin base + listen)
  config/            carga y validación de env
  routes/ controllers/ services/
  engines/           EngineAdapter + sqlserver/ postgres/ mysql/ sqldump/
  jobs/              worker (SKIP LOCKED), scheduler (cron), progress (SSE)
  gcp/               storage.client, cloudsql.client (Admin API)
  data/              pool + repositories/
  auth/              strategies/{local,ad} + middleware + jwt + bootstrap
  middleware/        errorHandler, audit, rateLimit
  lib/               logger, crypto, validation, audit
web/                 React + Vite (frontend)
test/                unitarios + integration/
MODELO_HOMOLOGACIONES/  scripts Python originales (referencia, NO tocar)
```

## Estado y pendientes

Backend y frontend **funcionalmente completos**, con hardening y tests (unitarios + integración). Pendiente:

- **Prueba E2E de un job real contra Cloud SQL** (el camino GCP de los adaptadores no se ha ejercitado contra infraestructura real).
- **Login AD contra un directorio real** (cableado verificado, no probado contra un AD vivo).
- **Post-scripts en PostgreSQL/MySQL** (hoy un job con scripts activos en esos motores falla en el pre-check, sin borrar nada).
- Menores: cálculo de `next_run_at`, revocación de sesión (denylist de JWT).
