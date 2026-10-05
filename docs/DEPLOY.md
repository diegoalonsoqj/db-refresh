# Despliegue en VPS (PM2, acceso por IP:puerto)

Guía paso a paso para la **primera etapa en producción**: un VPS Linux, la app accesible por `http://<IP>:3004` (sin dominio ni TLS) y los procesos gestionados por PM2 con arranque automático.

Supuestos: **Ubuntu 22.04/24.04 con systemd**, **PostgreSQL 17 en el mismo VPS**, API en el puerto **3004**. VPS de 4 GB de RAM habitual (se amplía en periodos de carga); PM2 limita cada proceso a 2 GB (`ecosystem.config.cjs`).

---

## 1. Preparar el servidor (una sola vez)

```bash
# Usuario sin privilegios para correr la app
sudo adduser --disabled-password --gecos "" dbrefresh
sudo usermod -aG sudo dbrefresh        # opcional, solo para el paso de pm2 startup

# Node.js 24 LTS
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git build-essential   # build-essential: por si argon2 tiene que compilar
node -v                                              # debe mostrar v24.x

# PM2 global
sudo npm install -g pm2

# Cliente de PostgreSQL 17 (pg_restore / psql) para el restore nativo
sudo apt-get install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt-get install -y postgresql-client-17
pg_restore --version    # 17.x (debe ser >= la versión del pg_dump que generó los dumps)
```

## 2. PostgreSQL 17

```bash
sudo apt-get install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt-get install -y postgresql-17

sudo -u postgres psql <<'SQL'
CREATE USER db_refresh WITH PASSWORD 'PON_AQUI_UN_PASSWORD_FUERTE';
CREATE DATABASE db_refresh OWNER db_refresh;
SQL
```

PostgreSQL escucha solo en `localhost` por defecto: **déjalo así** y no abras el puerto 5432.

## 3. Código

```bash
sudo -iu dbrefresh
git clone https://github.com/diegoalonsoqj/db-refresh.git
cd db-refresh
```

Si el repo es privado, el clone pedirá credenciales: usa un *Personal Access Token* de solo lectura o una *deploy key* SSH (`git@github.com:diegoalonsoqj/db-refresh.git`).

## 4. Configuración (`.env`)

```bash
cp .env.example .env
# Generar secretos:
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"   # -> JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # -> APP_ENCRYPTION_KEY
nano .env
chmod 600 .env
```

Valores clave:

```bash
NODE_ENV=production
PORT=3004
HTTPS_ENABLED=false        # acceso por IP:puerto sin TLS
TRUST_PROXY=false          # la API está expuesta directo, sin proxy delante
SERVE_WEB=true

APP_DB_HOST=localhost
APP_DB_NAME=db_refresh
APP_DB_USER=db_refresh
APP_DB_PASSWORD=<el del paso 2>

JWT_SECRET=<generado>
APP_ENCRYPTION_KEY=<generado>
BASE_ADMIN_PASSWORD=<uno propio, no el de por defecto>
```

- **`APP_ENCRYPTION_KEY`**: guárdala también fuera del servidor (gestor de contraseñas). Sin ella no se pueden descifrar los settings guardados (bind password de AD, JSON de la service account).
- **`BASE_ADMIN_PASSWORD`**: el admin base se crea en el primer arranque, así que ya nace con tu password. Si ya existe, este valor **no** lo resetea.
- **`HTTPS_ENABLED=false`** es obligatorio sin TLS: si no, la cookie de sesión lleva `Secure` (login roto) y la CSP fuerza HTTPS en los assets (pantalla en blanco).
- **`TRUST_PROXY=false`** es obligatorio sin proxy delante: si no, un cliente puede falsear su IP con `X-Forwarded-For` y saltarse el rate-limit de login.

## 5. Instalar, build y esquema

```bash
npm ci
npm --prefix web ci
npm --prefix web run build      # genera web/dist, que lo sirve la propia API
npm run migrate                 # aplica db/schema.sql (idempotente)
```

## 6. Arrancar con PM2 y dejarlo como servicio

```bash
pm2 start ecosystem.config.cjs --env production
pm2 ls                          # los 3 procesos en "online"
pm2 save                        # guarda la lista de procesos
pm2 startup                     # imprime un comando "sudo env PATH=... pm2 startup systemd -u dbrefresh ..."
# -> copia y ejecuta ESE comando tal cual
```

Rotación de logs, para que `logs/` no llene el disco:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 14
```

Qué hace `ecosystem.config.cjs`:

| Proceso | Script | Notas |
|---|---|---|
| `db-refresh-api` | `server/index.js` | API + frontend (`web/dist`) en el mismo puerto |
| `db-refresh-worker` | `server/jobs/worker.js` | Ejecuta los restores. `kill_timeout` de 15 min: un `reload`/`stop` espera a que termine el job en curso |
| `db-refresh-scheduler` | `server/jobs/scheduler.js` | Encola los restores programados |

Los tres: `autorestart`, `max_memory_restart: 2G`, heap de V8 en 1792 MB y reintentos con backoff exponencial (si PostgreSQL tarda en arrancar tras un reinicio del host, PM2 sigue reintentando en vez de rendirse).

## 7. Firewall

> ⚠️ Permite SSH **antes** de activar el firewall, o te quedarás fuera del VPS.

```bash
sudo ufw allow OpenSSH
sudo ufw allow from <IP_O_RED_DE_LA_EMPRESA> to any port 3004 proto tcp
sudo ufw enable
sudo ufw status
```

Si el proveedor tiene firewall en su panel (security group), aplica la misma regla allí. Sin HTTPS el puerto **no** debe quedar abierto a todo internet.

## 7b. Red hacia las instancias (scripts pre/post)

Los scripts pre/post se ejecutan conectándose por SQL a la **IP privada** de la instancia con una credencial del módulo **Credenciales**. Desde el VPS deben estar accesibles los puertos de las instancias que los usen (SQL Server 1433, PostgreSQL 5432, MySQL 3306). Compruébalo con *Probar conexión* en Catálogo → Instancias.

El **restore nativo de PostgreSQL** (`pg_restore`/`psql`) usa la misma conexión: necesita el 5432 de la IP privada y una credencial con permisos para crear BDs y esquemas (`postgres` o miembro de `cloudsqlsuperuser`). Los dumps se generan con `pg_dump -Ft` (tar) o en plano (`.sql`/`.sql.gz`, mejor con `--no-owner --no-privileges`); para restaurar un solo esquema desde un `.sql`, el dump debe haberse generado con `pg_dump -n <esquema>`.

## 8. Verificar

```bash
curl http://localhost:3004/api/health        # {"ok":true,"db":true,...}
```

1. Abre `http://<IP_DEL_VPS>:3004`, entra con `admin@dbrefresh.local` y la password del `.env`, y cámbiala desde el menú de usuario.
2. **Ajustes**: configura la service account de GCP (y AD si aplica) y pulsa **Probar**.
3. **Catálogo**: da de alta el proyecto, las instancias y los buckets.
4. `sudo reboot` y comprueba que la app vuelve sola (arranque automático).

---

## Actualizar a una versión nueva

```bash
cd ~/db-refresh

# 1. Sin cambios locales en archivos versionados (.env está ignorado y no cuenta)
git status

# 2. Código nuevo
git pull

# 3. Dependencias y build del frontend
npm ci && npm --prefix web ci && npm --prefix web run build

# 4. Migración de BD (idempotente): SIEMPRE antes del reload
npm run migrate

# 5. Recargar los 3 procesos (api, worker y scheduler)
pm2 reload ecosystem.config.cjs --env production
pm2 save
```

- **Migración antes del reload**: si el código nuevo usa una columna nueva y el worker arranca antes de migrar, sus consultas fallan.
- **Recargar los 3 procesos**, no solo la API: el worker y el scheduler son procesos aparte y, sin reload, siguen con el código viejo.
- El `reload` espera hasta 15 min a que el worker termine el restore en curso; si no quieres esperar, actualiza cuando no haya jobs corriendo.

**Verificación:**

```bash
git log --oneline -1                 # el último commit de main
pm2 ls                               # api, worker y scheduler en "online"
curl -s localhost:3004/api/health    # {"ok":true,"db":true,...}
```

En el navegador, recarga con `Ctrl+F5` para no ver assets en caché.

### Si el historial de `main` se reescribió (force push)

`git pull` falla o mezcla historiales. Sustituye el paso 2 por:

```bash
git fetch origin
git reset --hard origin/main
```

El `reset --hard` descarta cualquier cambio local en archivos versionados (revisa antes `git status`); los ignorados (`.env`, `Keys/`) no se tocan. El resto de pasos es igual. Si el VPS muestra cambios solo de permisos tras un `chmod -R`, ignóralos con `git config core.fileMode false`.

## Operación

| Para | Comando |
|---|---|
| Estado y memoria | `pm2 ls` / `pm2 monit` |
| Logs en vivo | `pm2 logs db-refresh-api` (o `-worker`, `-scheduler`) |
| Reiniciar un proceso | `pm2 restart db-refresh-api` |
| Backup de la BD de la app | `pg_dump -U db_refresh -h localhost db_refresh > backup.sql` |

Si la columna de reinicios (`↺`) de `pm2 ls` sube sola, algún proceso está llegando a su tope de memoria: revisar los logs.

## Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| El login responde OK pero luego todo da 401 | Falta `HTTPS_ENABLED=false`: la cookie lleva `Secure` y el navegador la descarta sobre HTTP |
| Pantalla en blanco, errores de assets en la consola | Falta `HTTPS_ENABLED=false` (CSP `upgrade-insecure-requests`) o no se hizo `npm --prefix web run build` |
| `/` devuelve 404 | No existe `web/dist` (falta el build) o `SERVE_WEB=false` |
| Login bloqueado con 429 | Rate-limit: 10 intentos fallidos por IP en 15 min. Esperar o reiniciar la API |
| `/api/health` con `"db": false` | PostgreSQL caído o credenciales `APP_DB_*` incorrectas |
| La app no vuelve tras reiniciar el VPS | Falta ejecutar el comando que imprime `pm2 startup`, o `pm2 save` tras el último cambio |

---

## Siguiente etapa: dominio + HTTPS

Esta etapa envía la password y la cookie de sesión **en claro**, y aún no hay revocación de sesión (un JWT capturado vale `JWT_EXPIRES_IN`). En cuanto haya dominio:

1. Poner **Caddy** (o Nginx + Let's Encrypt) delante, proxyando a `localhost:3004`.
2. En el `.env`: `HTTPS_ENABLED=true` (o quitar la línea) y `TRUST_PROXY=1`.
3. Cerrar el 3004 en el firewall y abrir solo 80/443.
4. `pm2 reload ecosystem.config.cjs --env production`.
