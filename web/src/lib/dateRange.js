// Fechas de los filtros como `AAAA-MM-DD` en la zona del navegador (sin pasar por UTC).

export function formatDay(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseDay(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v ?? '');
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export const DATE_PRESETS = [
  { key: 'today', label: 'Hoy' },
  { key: 'last7', label: 'Últimos 7 días' },
  { key: 'last30', label: 'Últimos 30 días' },
  { key: 'thisMonth', label: 'Este mes' },
  { key: 'prevMonth', label: 'Mes anterior' },
];

/** Rango de un atajo, relativo a `now` (inclusivo en ambos extremos). */
export function presetRange(preset, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAgo = (n) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);
  switch (preset) {
    case 'today': return { from: today, to: today };
    case 'last7': return { from: daysAgo(6), to: today };
    case 'last30': return { from: daysAgo(29), to: today };
    case 'thisMonth': return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: today };
    case 'prevMonth': return {
      from: new Date(today.getFullYear(), today.getMonth() - 1, 1),
      to: new Date(today.getFullYear(), today.getMonth(), 0),
    };
    default: return { from: undefined, to: undefined };
  }
}
