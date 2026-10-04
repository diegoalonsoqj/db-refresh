// Formatea las tablas de resultados de un post-script (SELECT de reporte) como
// líneas de log alineadas (el log del job se muestra en monoespaciada).
// Función pura: sin BD ni red.

const MAX_ROWS = 200;      // filas por tabla que se vuelcan al log
const MAX_CELL = 80;       // caracteres por celda (el resto se recorta con «…»)
// Una fila se marca como aviso si alguna celda indica error (p.ej. Estado = 'ERROR').
const ERROR_CELL = /^(error|failed|fallido|fail)$/i;

function cellText(value) {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `0x${value.toString('hex').toUpperCase()}`;
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > MAX_CELL ? `${text.slice(0, MAX_CELL - 1)}…` : text;
}

/**
 * @param rows    array de objetos (una fila = { columna: valor })
 * @param columns nombres de columna en orden (por defecto, las claves de la 1ª fila)
 * @returns [[level, text], ...] cabecera, separador y filas; 'warning' en filas con error
 */
export function formatResultSet(rows, columns = null) {
  const cols = columns?.length ? columns : Object.keys(rows[0] ?? {});
  if (!cols.length) return [];
  if (!rows.length) return [['info', `(sin filas) ${cols.join(' | ')}`]];

  const shown = rows.slice(0, MAX_ROWS).map((row) => cols.map((c) => cellText(row[c])));
  const widths = cols.map((c, i) => Math.max(c.length, ...shown.map((r) => r[i].length)));
  const line = (cells) => cells.map((v, i) => v.padEnd(widths[i])).join('  ').trimEnd();

  const out = [
    ['info', line(cols)],
    ['info', widths.map((w) => '-'.repeat(w)).join('  ')],
    ...shown.map((cells) => [cells.some((v) => ERROR_CELL.test(v)) ? 'warning' : 'info', line(cells)]),
  ];
  if (rows.length > MAX_ROWS) out.push(['info', `(${rows.length - MAX_ROWS} fila(s) más omitidas)`]);
  return out;
}
