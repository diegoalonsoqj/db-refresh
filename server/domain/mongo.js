// Reglas de MongoDB (Community y Atlas): opciones de conexión, cadena de conexión,
// URI y argumentos de mongorestore. Funciones puras (sin red ni BD), alineadas con
// db-keeper, que genera los backups (`mongodump --archive [--gzip]`, una BD por archivo).
import { ValidationError } from './errors.js';

/** Opciones de conexión admitidas (lista cerrada: no se cuelan parámetros arbitrarios en la URI). */
export const MONGO_CONN_OPTION_KEYS = [
  'authSource', 'replicaSet', 'readPreference', 'appName', 'retryWrites', 'w', 'tls', 'directConnection',
];
export const MONGO_READ_PREFERENCES = ['primary', 'primaryPreferred', 'secondary', 'secondaryPreferred', 'nearest'];

const BOOL_KEYS = new Set(['retryWrites', 'tls', 'directConnection']);
const OPTION_VALUE_RE = /^[A-Za-z0-9._-]{1,100}$/;
// Host de la conexión: nombre/IP, o lista h1:27017,h2:27017 (replica set).
const HOST_RE = /^[A-Za-z0-9.-]+(:\d{1,5})?(,[A-Za-z0-9.-]+(:\d{1,5})?)*$/;
const SRV_HOST_RE = /^[A-Za-z0-9.-]+$/;

/** Valida una opción; devuelve el motivo si no es válida o null si está bien. */
export function validateMongoOption(key, value) {
  if (!MONGO_CONN_OPTION_KEYS.includes(key)) return `opción no admitida: ${key}`;
  if (BOOL_KEYS.has(key)) return value === 'true' || value === 'false' ? null : `${key} debe ser true o false`;
  if (key === 'readPreference') return MONGO_READ_PREFERENCES.includes(value) ? null : `readPreference inválido: ${value}`;
  if (key === 'w') return value === 'majority' || /^\d{1,2}$/.test(value) ? null : `w inválido: ${value}`;
  return OPTION_VALUE_RE.test(value) ? null : `${key} inválido: ${value}`;
}

/**
 * Normaliza las opciones de una instancia: objeto { clave: valor } o texto
 * "a=1&b=2". Lanza ValidationError con todos los motivos si alguna no es válida.
 */
export function normalizeMongoOptions(input) {
  const entries = typeof input === 'string'
    ? input.split('&').map((p) => p.trim()).filter(Boolean).map((part) => {
      const eq = part.indexOf('=');
      return eq >= 0 ? [part.slice(0, eq).trim(), part.slice(eq + 1).trim()] : [part, ''];
    })
    : Object.entries(input ?? {}).map(([k, v]) => [k, String(v ?? '').trim()]);
  const options = {};
  const errors = [];
  for (const [key, value] of entries) {
    const err = validateMongoOption(key, value);
    if (err) errors.push(err);
    else options[key] = value;
  }
  if (errors.length) throw new ValidationError(`Opciones de conexión inválidas: ${errors.join('; ')}`);
  return options;
}

/** Valida el host según el tipo de conexión (SRV = un nombre de cluster, sin puerto). */
export function assertMongoHost(host, srv) {
  const h = String(host ?? '').trim();
  if (srv ? !SRV_HOST_RE.test(h) : !HOST_RE.test(h)) {
    throw new ValidationError(srv
      ? `Host SRV inválido: ${h} (solo el nombre del cluster, p.ej. cluster0.abcde.mongodb.net)`
      : `Host inválido: ${h} (nombre o IP, o lista h1:27017,h2:27017)`);
  }
  return h;
}

/**
 * Desarma una cadena `mongodb://` o `mongodb+srv://` (la que entrega Atlas). La
 * contraseña NO se devuelve: va en Credenciales (cifrada), nunca en la instancia.
 * -> { srv, host, port, username, options, rejected }
 */
export function parseMongoConnectionString(raw) {
  const m = /^(mongodb(?:\+srv)?):\/\/(?:([^@/]*)@)?([^/?]+)(?:\/[^?]*)?(?:\?(.*))?$/i.exec(String(raw ?? '').trim());
  if (!m) throw new ValidationError('Cadena inválida: debe empezar con mongodb:// o mongodb+srv://');
  const [, scheme, userInfo, hostPart, query] = m;
  const srv = scheme.toLowerCase() === 'mongodb+srv';
  let username = null;
  if (userInfo) {
    const colon = userInfo.indexOf(':');
    const user = decodeURIComponent(colon >= 0 ? userInfo.slice(0, colon) : userInfo);
    // Atlas entrega marcadores como <db_username>: no son un usuario real.
    username = user && !/^<.*>$/.test(user) ? user : null;
  }
  let host = hostPart;
  let port = null;
  if (!srv && !host.includes(',')) {
    const hp = /^(.+):(\d{1,5})$/.exec(host);
    if (hp) { host = hp[1]; port = Number(hp[2]); }
  }
  const options = {};
  const rejected = [];
  for (const part of (query ?? '').split('&').filter(Boolean)) {
    const eq = part.indexOf('=');
    const key = eq >= 0 ? part.slice(0, eq) : part;
    const value = eq >= 0 ? decodeURIComponent(part.slice(eq + 1)) : '';
    if (validateMongoOption(key, value)) rejected.push(key);
    else options[key] = value;
  }
  return { srv, host, port, username, options, rejected };
}

/**
 * URI de conexión para el driver y mongorestore (con la contraseña: no se loguea
 * nunca). Por defecto `authSource=admin`; en SRV (Atlas), TLS. Sin BD en la ruta:
 * mongorestore la tomaría como destino. Las opciones de la instancia pisan los
 * valores por defecto.
 * @param conn { host, port, user, password, mongoSrv, connOptions }
 */
export function buildMongoUri(conn, extra = {}) {
  const auth = conn.user
    ? `${encodeURIComponent(conn.user)}:${encodeURIComponent(conn.password ?? '')}@`
    : '';
  const srv = conn.mongoSrv === true;
  const hosts = srv || /[,:]/.test(conn.host) ? conn.host : `${conn.host}:${conn.port || 27017}`;
  const params = new URLSearchParams({ authSource: 'admin' });
  if (srv) params.set('tls', 'true');
  for (const [k, v] of Object.entries({ ...(conn.connOptions ?? {}), ...extra })) params.set(k, v);
  return `${srv ? 'mongodb+srv' : 'mongodb'}://${auth}${hosts}/?${params.toString()}`;
}

/** Etiqueta de la conexión para logs y mensajes (sin la contraseña). */
export function mongoLabel(conn) {
  const hosts = conn.mongoSrv || /[,:]/.test(conn.host) ? conn.host : `${conn.host}:${conn.port || 27017}`;
  return `${conn.user}@${conn.mongoSrv ? 'mongodb+srv://' : ''}${hosts}`;
}

// --- Archivos de backup ------------------------------------------------------

/** Extensiones de `mongodump --archive` (db-keeper: `.archive` o `.archive.gz` con --gzip). */
export const MONGO_EXTENSIONS = ['.archive', '.archive.gz'];

/** Formato de un archivo de Mongo: 'archive' | 'archive-gz' | null (no admitido). */
export function mongoArchiveFormat(fileName) {
  const f = String(fileName).toLowerCase();
  if (f.endsWith('.archive.gz')) return 'archive-gz';
  if (f.endsWith('.archive')) return 'archive';
  return null;
}

// BD de sistema de MongoDB: nunca se restaura sobre ellas ni se toman como origen.
export const MONGO_SYSTEM_DATABASES = ['admin', 'config', 'local'];

/**
 * BD de origen de un archivo a partir de sus namespaces (cabecera del archivo). db-keeper
 * vuelca una BD por archivo; un volcado completo puede traer además `admin` (usuarios),
 * que se ignora. Lanza si no hay ninguna o hay varias.
 */
export function pickSourceDatabase(namespaces, fileName = 'el archivo') {
  const dbs = [...new Set(namespaces.map((n) => n.db))].filter((db) => !MONGO_SYSTEM_DATABASES.includes(db));
  if (dbs.length === 0) {
    throw new ValidationError(`${fileName} no contiene colecciones de ninguna BD de usuario`);
  }
  if (dbs.length > 1) {
    throw new ValidationError(
      `${fileName} contiene varias BD (${dbs.join(', ')}): se restaura un archivo por BD, como los genera db-keeper`,
    );
  }
  return dbs[0];
}

// Nombre de BD de MongoDB: sin . / \ $ " espacios ni nulos, hasta 63 caracteres.
const MONGO_DB_RE = /^[A-Za-z0-9_-]{1,63}$/;

export function assertMongoDbName(name, what = 'Nombre de BD') {
  if (!MONGO_DB_RE.test(String(name))) {
    throw new ValidationError(`${what} inválido para MongoDB: ${name} (letras, números, _ y -; hasta 63)`);
  }
  return name;
}

/**
 * Argumentos de mongorestore (archivo por stdin). La URI con la contraseña va en el
 * archivo `--config` (no en los argumentos: se verían en la lista de procesos).
 * `--drop` además del borrado previo de la BD: no deja colecciones a medias si la
 * BD se recreó entre medias. `--nsFrom/--nsTo` restauran en otra BD.
 */
export function buildMongorestoreArgs({ configFile, gzip, sourceDb, targetDb }) {
  return [
    `--config=${configFile}`,
    '--archive',
    ...(gzip ? ['--gzip'] : []),
    `--nsInclude=${sourceDb}.*`,
    ...(sourceDb !== targetDb ? [`--nsFrom=${sourceDb}.*`, `--nsTo=${targetDb}.*`] : []),
    '--drop',
    '--stopOnError',
  ];
}

/** Contenido YAML del `--config` de mongorestore (solo la URI). */
export function mongorestoreConfig(uri) {
  return `uri: "${String(uri).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\n`;
}

// Línea de progreso de mongorestore ("[####......]  db.coll  1.2MB/5.0MB  (24.0%)"):
// se emite cada segundo por colección y no aporta al log del job.
const PROGRESS_RE = /\[[#.]{5,}\]/;
// Marca de tiempo inicial de cada línea ("2026-10-13T03:18:00.123-0500\t").
const STAMP_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?\s+/;

/** Limpia una línea de salida de mongorestore; null = no va al log (progreso). */
export function cleanMongoLine(line) {
  if (PROGRESS_RE.test(line)) return null;
  return String(line).replace(STAMP_RE, '').trim() || null;
}

/** Resumen final de mongorestore -> { restored, failed } o null si la línea no lo es. */
export function parseRestoreSummary(line) {
  const m = /(\d+) document\(s\) restored successfully\. (\d+) document\(s\) failed to restore/.exec(line);
  return m ? { restored: Number(m[1]), failed: Number(m[2]) } : null;
}
