// Carga y validación de configuración. Único punto que lee process.env.
// En prod, los secretos deberían resolverse desde Secret Manager antes de aquí.
import 'dotenv/config';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTrustProxy } from '../lib/http.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function req(name, fallback = undefined) {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') {
    throw new Error(`Config faltante: variable de entorno ${name} es obligatoria`);
  }
  return v;
}

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`Config inválida: ${name} debe ser entero`);
  return n;
}

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return !['false', '0', 'no'].includes(raw.trim().toLowerCase());
}

// Convierte '8h' | '30m' | '7d' | '3600s' | '3600' a milisegundos.
function durationMs(value, fallbackMs) {
  if (!value) return fallbackMs;
  const m = /^(\d+)\s*([smhd])?$/.exec(String(value).trim());
  if (!m) return fallbackMs;
  const n = Number.parseInt(m[1], 10);
  const unit = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3 }[m[2] ?? 's'];
  return n * unit;
}

const env = process.env.NODE_ENV ?? 'development';

export const config = {
  env,
  port: int('PORT', 3000),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  http: {
    // ¿Se sirve por HTTPS? Controla cookie Secure, HSTS y upgrade-insecure-requests.
    // Default: true en production. Acceso por IP:puerto sin TLS -> HTTPS_ENABLED=false.
    https: bool('HTTPS_ENABLED', env === 'production'),
    // false si la API está expuesta directa (sin reverse proxy). Ver lib/http.js.
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY, 1),
    // Build del frontend que sirve Express si existe (web/dist). SERVE_WEB=false lo desactiva.
    serveWeb: bool('SERVE_WEB', true),
    webDistDir: process.env.WEB_DIST_DIR || join(ROOT, 'web', 'dist'),
  },

  db: {
    host: req('APP_DB_HOST', 'localhost'),
    port: int('APP_DB_PORT', 5432),
    database: req('APP_DB_NAME', 'db_refresh'),
    user: req('APP_DB_USER', 'db_refresh'),
    password: req('APP_DB_PASSWORD'),
    poolMax: int('APP_DB_POOL_MAX', 10),
  },

  // Master key para cifrar settings sensibles en la BD (AES-256-GCM).
  // Opcional al arrancar; obligatoria solo al cifrar/descifrar (lib/crypto.js).
  encryptionKey: process.env.APP_ENCRYPTION_KEY,

  auth: {
    jwtSecret: req('JWT_SECRET'),
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
    // maxAge de la cookie de sesión, derivado del mismo TTL que el JWT.
    sessionMaxAgeMs: durationMs(process.env.JWT_EXPIRES_IN ?? '8h', 8 * 3600e3),
    // Admin base garantizado en la BD al arrancar (para no quedar fuera).
    // OJO: password por defecto conocido; cambiar en cuanto sea posible.
    baseAdmin: {
      enabled: (process.env.BASE_ADMIN_ENABLED ?? 'true') !== 'false',
      email: process.env.BASE_ADMIN_EMAIL ?? 'admin@dbrefresh.local',
      password: process.env.BASE_ADMIN_PASSWORD ?? 'P4$$w0rD',
    },
    // Fallback de AD si no hay config en la BD (Ajustes > AD / LDAP la pisa).
    ad: {
      url: process.env.AD_URL,
      mode: process.env.AD_MODE,                 // direct | search
      domain: process.env.AD_DOMAIN,             // modo direct: EMPRESA o empresa.com
      security: process.env.AD_SECURITY,         // starttls | ldaps | none
      baseDn: process.env.AD_BASE_DN,            // searchBase
      bindDn: process.env.AD_BIND_DN,            // modo search: cuenta de servicio
      bindPassword: process.env.AD_BIND_PASSWORD,
      userFilter: process.env.AD_USER_FILTER,
      tlsRejectUnauthorized: process.env.AD_TLS_REJECT_UNAUTHORIZED
        ? process.env.AD_TLS_REJECT_UNAUTHORIZED !== 'false'
        : undefined,
    },
  },

  gcp: {
    // google-auth-library / clientes GCP leen GOOGLE_APPLICATION_CREDENTIALS
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  },

  worker: {
    id: process.env.WORKER_ID ?? `worker-${process.pid}`,
    pollIntervalMs: int('WORKER_POLL_INTERVAL_MS', 5000),
    // Jobs a la vez (de instancias distintas; los de una misma instancia van en orden).
    concurrency: Math.max(1, int('WORKER_CONCURRENCY', 3)),
    operationTimeoutSeconds: int('OPERATION_TIMEOUT_SECONDS', 10800),
    operationPollIntervalSeconds: int('OPERATION_POLL_INTERVAL_SECONDS', 30),
    // Pre-check: cuánto esperar a que la instancia no tenga operaciones en curso
    // (backup automático, otro import...) antes de abortar el job sin tocar nada.
    instanceIdleWaitSeconds: int('INSTANCE_IDLE_WAIT_SECONDS', 900),
    // Timeout por lote (GO) de un post-script SQL.
    postScriptTimeoutMs: int('POST_SCRIPT_TIMEOUT_MS', 600_000),
  },

  // Restore nativo de PostgreSQL (pg_restore/psql ejecutados en este servidor).
  nativeRestore: {
    // Carpeta de los binarios (vacío = los del PATH, p.ej. postgresql-client-17 en Ubuntu).
    binDir: process.env.PG_BIN_DIR ?? '',
    // Tiempo máximo de un pg_restore/psql (por BD/esquema).
    timeoutSeconds: int('NATIVE_RESTORE_TIMEOUT_SECONDS', 10800),
  },
};
