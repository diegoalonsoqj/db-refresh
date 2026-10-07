// Tareas de restore y su programación (modelo de db-keeper): funciones puras
// compartidas por el servicio, el scheduler y los tests.
//
// Una tarea guarda QUÉ restaurar (instancia, carpeta del bucket, mapping) y,
// aparte, CUÁNDO: sin programar | una vez (fecha y hora) | recurrente (cron),
// en una zona horaria. Cada fila del mapping elige el backup de dos formas:
//   - source 'fixed':  un archivo concreto (backupFile).
//   - source 'latest': el más reciente de la carpeta que encaje con un patrón
//                      (`PaynovaBD_PRD_*.sql.gz`), resuelto al disparar. Es lo
//                      que sirve en recurrentes: el origen genera un archivo
//                      nuevo con fecha en cada backup.
import { CronExpressionParser } from 'cron-parser';
import { ValidationError } from './errors.js';
import { validateMapping } from './restoreMapping.js';

export const SCHEDULE_MODES = ['none', 'once', 'recurring'];
export const BACKUP_SOURCES = ['fixed', 'latest'];

// Patrón: los caracteres de un nombre de backup más '*' (cualquier secuencia).
const SAFE_PATTERN = /^[A-Za-z0-9._*-]+$/;

// --- Patrones ---------------------------------------------------------------

/** Patrón glob ('*' = cualquier secuencia) -> RegExp que exige coincidencia completa. */
export function globToRegExp(pattern) {
  const body = String(pattern).split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}$`, 'i');
}

/**
 * Backup más reciente que encaja con el patrón. Ordena por fecha de
 * actualización en GCS y, a igualdad (o sin fecha), por nombre descendente
 * (los nombres llevan la fecha: `X_20261005_141622` > `X_20261002_201635`).
 * @param files [{ fileName, updated }]
 * @returns el archivo o null
 */
export function pickLatest(files, pattern) {
  const re = globToRegExp(pattern);
  const time = (f) => (f.updated ? Date.parse(f.updated) || 0 : 0);
  return (files ?? [])
    .filter((f) => re.test(f.fileName))
    .sort((a, b) => time(b) - time(a) || b.fileName.localeCompare(a.fileName))[0] ?? null;
}

/**
 * Patrón sugerido a partir de un nombre con fecha: las secuencias de 6+ dígitos
 * (fecha, hora) pasan a '*'. `PaynovaBD_PRD_20261002_201635.sql.gz` ->
 * `PaynovaBD_PRD_*.sql.gz`.
 */
export function suggestPattern(fileName) {
  return String(fileName)
    .replace(/\d{6,}/g, '*')
    .replace(/\*(?:[_-]\*)+/g, '*');
}

// --- Mapping de una tarea ---------------------------------------------------

/**
 * Valida el mapping de una tarea. Reutiliza las reglas de un restore
 * (`validateMapping`) y añade el origen del backup por fila.
 * @returns [{ source, backupFile|null, pattern|null, targetDb, importUser, ... }]
 */
export function validateTaskMapping(engine, mapping, method = 'import') {
  if (!Array.isArray(mapping) || mapping.length === 0) {
    throw new ValidationError('mapping vacío: indica al menos un backup -> BD');
  }
  const sources = mapping.map((m) => {
    const source = m?.source ?? 'fixed';
    if (!BACKUP_SOURCES.includes(source)) throw new ValidationError(`Origen de backup inválido: ${source}`);
    if (source === 'fixed') return { source, pattern: null };
    const pattern = String(m?.pattern ?? '').trim();
    if (!pattern || !SAFE_PATTERN.test(pattern)) {
      throw new ValidationError(`Patrón de backup inválido: «${pattern}» (letras, números, . _ - y *)`);
    }
    return { source, pattern };
  });
  // Para las reglas comunes, un patrón cuenta como nombre (los '*' no son válidos en un nombre).
  const asRestore = mapping.map((m, i) => ({
    ...m,
    backupFile: sources[i].source === 'latest' ? sources[i].pattern.replaceAll('*', 'x') : m?.backupFile,
  }));
  return validateMapping(engine, asRestore, method).map((row, i) => ({
    ...row,
    source: sources[i].source,
    backupFile: sources[i].source === 'fixed' ? row.backupFile : null,
    pattern: sources[i].pattern,
  }));
}

/**
 * Mapping listo para lanzar: cada fila 'latest' toma el backup más reciente de
 * `files` (los de la carpeta de la tarea). Si algún patrón no encaja con
 * ninguno, falla sin lanzar nada.
 */
export function resolveTaskMapping(mapping, files) {
  const missing = [];
  const rows = mapping.map(({ source, pattern, ...row }) => {
    if ((source ?? 'fixed') !== 'latest') return row;
    const hit = pickLatest(files, pattern);
    if (!hit) missing.push(pattern);
    return { ...row, backupFile: hit?.fileName ?? null };
  });
  if (missing.length) {
    throw new ValidationError(`Ningún backup de la carpeta coincide con: ${missing.join(', ')}`);
  }
  return rows;
}

// --- Programación -----------------------------------------------------------

export function isValidTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return Boolean(tz);
  } catch {
    return false;
  }
}

/** Próxima ejecución de un cron en una zona horaria, posterior a `from`. */
export function nextRunForCron(cronExpr, timezone, from) {
  try {
    return CronExpressionParser.parse(cronExpr, { currentDate: from, tz: timezone }).next().toDate();
  } catch {
    throw new ValidationError(`Expresión cron inválida: ${cronExpr}`);
  }
}

/** Desfase (ms) de una zona IANA respecto a UTC en un instante. */
function tzOffsetMs(timezone, at) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const p = Object.fromEntries(parts.filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - at.getTime();
}

/**
 * Hora de pared (`2026-10-10T21:00`, la de un <input type="datetime-local">)
 * interpretada en `timezone` -> instante absoluto.
 */
export function zonedWallClockToInstant(localIso, timezone) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(localIso ?? '').trim());
  if (!m) throw new ValidationError('Fecha y hora inválidas (formato AAAA-MM-DDTHH:MM)');
  const [, y, mo, d, h, mi] = m.map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  return new Date(guess - tzOffsetMs(timezone, new Date(guess)));
}

/** Instante -> hora de pared `AAAA-MM-DDTHH:MM` en la zona (para rellenar el formulario). */
export function instantToWallClock(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(date));
  const p = Object.fromEntries(parts.filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

/**
 * Valida la programación pedida y calcula su próxima ejecución.
 * @param input { mode, runAt?, cron?, timezone? }
 * @returns { mode, cronExpr, runAt, timezone, nextRunAt, isActive }
 */
export function buildSchedule(input, now, defaultTimezone) {
  const mode = input?.mode ?? 'none';
  if (!SCHEDULE_MODES.includes(mode)) throw new ValidationError(`Modo de programación inválido: ${mode}`);
  const timezone = String(input?.timezone ?? '').trim() || defaultTimezone;
  if (!isValidTimezone(timezone)) throw new ValidationError(`Zona horaria inválida: ${timezone}`);

  if (mode === 'none') {
    return { mode, cronExpr: null, runAt: null, timezone, nextRunAt: null, isActive: false };
  }
  if (mode === 'once') {
    const runAt = zonedWallClockToInstant(input.runAt, timezone);
    if (runAt.getTime() <= now.getTime()) throw new ValidationError('La fecha y hora ya pasaron: indica una futura');
    return { mode, cronExpr: null, runAt, timezone, nextRunAt: runAt, isActive: true };
  }
  const cronExpr = String(input?.cron ?? '').trim();
  if (!cronExpr) throw new ValidationError('Indica la recurrencia (expresión cron)');
  return { mode, cronExpr, runAt: null, timezone, nextRunAt: nextRunForCron(cronExpr, timezone, now), isActive: true };
}

/**
 * Estado tras disparar: una vez -> se desactiva; recurrente -> siguiente del
 * cron (si el cron ya no es válido, se desactiva para no reintentar sin fin).
 */
export function afterRun(task, now) {
  if (task.schedule_mode !== 'recurring') return { nextRunAt: null, isActive: false };
  try {
    return { nextRunAt: nextRunForCron(task.cron_expr, task.timezone, now), isActive: true };
  } catch {
    return { nextRunAt: null, isActive: false };
  }
}
