// Utilidades de UI para tareas de restore y su programación. La validación real
// está en el servidor (server/domain/restoreTask.js); esto solo da vista previa.

export const DEFAULT_TIMEZONE = 'America/Lima';

/** Patrón glob ('*' = cualquier secuencia) -> RegExp de coincidencia completa. */
export function globToRegExp(pattern) {
  const body = String(pattern).split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}$`, 'i');
}

/** Backup más reciente que encaja con el patrón (misma regla que el servidor). */
export function pickLatest(files, pattern) {
  if (!pattern) return null;
  const re = globToRegExp(pattern);
  const time = (f) => (f.updated ? Date.parse(f.updated) || 0 : 0);
  return (files ?? [])
    .filter((f) => re.test(f.fileName))
    .sort((a, b) => time(b) - time(a) || b.fileName.localeCompare(a.fileName))[0] ?? null;
}

/** `PaynovaBD_PRD_20261002_201635.sql.gz` -> `PaynovaBD_PRD_*.sql.gz`. */
export function suggestPattern(fileName) {
  return String(fileName ?? '').replace(/\d{6,}/g, '*').replace(/\*(?:[_-]\*)+/g, '*');
}

// --- Constructor de recurrencia (como db-keeper) ----------------------------

export const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Cron a partir del constructor: diaria | semanal | mensual | avanzada. */
export function buildCron(freq, time, weekday, dom, advanced) {
  const [h, m] = String(time || '00:00').split(':').map(Number);
  if (freq === 'daily') return `${m} ${h} * * *`;
  if (freq === 'weekly') return `${m} ${h} * * ${weekday}`;
  if (freq === 'monthly') return `${m} ${h} ${dom} * *`;
  return String(advanced ?? '').trim();
}

/** Reconstruye el constructor desde un cron simple; si no encaja, 'advanced'. */
export function parseCron(cron) {
  const pad = (n) => String(n).padStart(2, '0');
  const c = String(cron ?? '').trim();
  let mm;
  if ((mm = /^(\d+) (\d+) \* \* \*$/.exec(c))) return { freq: 'daily', time: `${pad(+mm[2])}:${pad(+mm[1])}`, weekday: 1, dom: 1 };
  if ((mm = /^(\d+) (\d+) \* \* (\d)$/.exec(c))) return { freq: 'weekly', time: `${pad(+mm[2])}:${pad(+mm[1])}`, weekday: +mm[3], dom: 1 };
  if ((mm = /^(\d+) (\d+) (\d+) \* \*$/.exec(c))) return { freq: 'monthly', time: `${pad(+mm[2])}:${pad(+mm[1])}`, weekday: 1, dom: +mm[3] };
  return { freq: 'advanced', time: '21:00', weekday: 1, dom: 1 };
}

/** Instante -> `AAAA-MM-DDTHH:MM` de pared en la zona (para <input type="datetime-local">). */
export function wallClock(iso, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

/** Fecha y hora en la zona de la tarea, legible. */
export function fmtInZone(iso, timezone) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-PE', {
    timeZone: timezone, dateStyle: 'short', timeStyle: 'short',
  });
}

/** Resumen de la programación: «Diaria a las 21:00», «Una vez: 10/10/26 21:00»... */
export function describeSchedule(task) {
  if (task.schedule_mode === 'once') return `Una vez: ${fmtInZone(task.run_at, task.timezone)}`;
  if (task.schedule_mode !== 'recurring') return 'Sin programar';
  const p = parseCron(task.cron_expr);
  if (p.freq === 'daily') return `Diaria a las ${p.time}`;
  if (p.freq === 'weekly') return `Cada ${WEEKDAYS[p.weekday] ?? '?'} a las ${p.time}`;
  if (p.freq === 'monthly') return `Día ${p.dom} de cada mes a las ${p.time}`;
  return `Cron: ${task.cron_expr}`;
}
