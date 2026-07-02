// Carga y validación de configuración. Único punto que lee process.env.
// En prod, los secretos deberían resolverse desde Secret Manager antes de aquí.
import 'dotenv/config';

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

// Convierte '8h' | '30m' | '7d' | '3600s' | '3600' a milisegundos.
function durationMs(value, fallbackMs) {
  if (!value) return fallbackMs;
  const m = /^(\d+)\s*([smhd])?$/.exec(String(value).trim());
  if (!m) return fallbackMs;
  const n = Number.parseInt(m[1], 10);
  const unit = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3 }[m[2] ?? 's'];
  return n * unit;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: int('PORT', 3000),
  logLevel: process.env.LOG_LEVEL ?? 'info',

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
    // Rol asignado a un usuario de AD la PRIMERA vez que inicia sesión
    // (luego un admin puede cambiarlo). Least-privilege por defecto.
    adDefaultRole: process.env.AD_DEFAULT_ROLE ?? 'viewer',
    // Admin base garantizado en la BD al arrancar (para no quedar fuera).
    // OJO: password por defecto conocido; cambiar en cuanto sea posible.
    baseAdmin: {
      enabled: (process.env.BASE_ADMIN_ENABLED ?? 'true') !== 'false',
      email: process.env.BASE_ADMIN_EMAIL ?? 'admin@dbrefresh.local',
      password: process.env.BASE_ADMIN_PASSWORD ?? 'P4$$w0rD',
    },
    ad: {
      url: process.env.AD_URL,
      baseDn: process.env.AD_BASE_DN,
      bindDn: process.env.AD_BIND_DN,
      bindPassword: process.env.AD_BIND_PASSWORD,
    },
  },

  gcp: {
    // google-auth-library / clientes GCP leen GOOGLE_APPLICATION_CREDENTIALS
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  },

  worker: {
    id: process.env.WORKER_ID ?? `worker-${process.pid}`,
    pollIntervalMs: int('WORKER_POLL_INTERVAL_MS', 5000),
    operationTimeoutSeconds: int('OPERATION_TIMEOUT_SECONDS', 10800),
    operationPollIntervalSeconds: int('OPERATION_POLL_INTERVAL_SECONDS', 30),
  },
};
