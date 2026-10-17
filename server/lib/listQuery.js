// Listados con búsqueda, filtros, orden y paginación (como db-keeper): parseo del
// query string y piezas de SQL parametrizado. El cliente nunca aporta texto SQL:
// `sort` se valida contra claves permitidas que el código traduce a expresiones fijas.
import { ValidationError } from '../domain/errors.js';

export const PAGE_SIZES = [10, 20, 50, 100];
export const DEFAULT_PAGE_SIZE = PAGE_SIZES[0];
const MAX_LIMIT = 100;
const MAX_TEXT = 100;

function intParam(raw, label, { min, max, fallback }) {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || (max !== undefined && n > max)) {
    throw new ValidationError(`${label} inválido: ${raw}`);
  }
  return n;
}

function textParam(raw, label) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') throw new ValidationError(`${label} inválido`);
  const v = raw.trim();
  if (v.length > MAX_TEXT) throw new ValidationError(`${label} demasiado largo (máx. ${MAX_TEXT})`);
  return v || undefined;
}

/**
 * Parsea el query string de un listado.
 * `sorts`: claves de orden permitidas. `filters`: { nombre: tipo } con tipo
 * 'text' | 'date' (instante ISO) | 'bool' ('true'/'false') | array de valores permitidos.
 * Vacío = sin filtro. Devuelve { limit, offset, q, sort, dir, filters }.
 */
export function parseListQuery(query = {}, { sorts, filters = {} }) {
  const limit = intParam(query.limit, 'limit', { min: 1, max: MAX_LIMIT, fallback: DEFAULT_PAGE_SIZE });
  const offset = intParam(query.offset, 'offset', { min: 0, fallback: 0 });
  const q = textParam(query.q, 'Búsqueda');

  const sort = textParam(query.sort, 'sort');
  if (sort !== undefined && !sorts.includes(sort)) {
    throw new ValidationError(`sort inválido: ${sort}. Permitidos: ${sorts.join(', ')}`);
  }
  const dir = textParam(query.dir, 'dir');
  if (dir !== undefined && dir !== 'asc' && dir !== 'desc') throw new ValidationError(`dir inválido: ${dir}`);

  const out = {};
  for (const [name, type] of Object.entries(filters)) {
    const v = textParam(query[name], name);
    if (v === undefined) continue;
    if (Array.isArray(type)) {
      if (!type.includes(v)) throw new ValidationError(`${name} inválido: ${v}. Permitidos: ${type.join(', ')}`);
      out[name] = v;
    } else if (type === 'date') {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw new ValidationError(`${name} inválido: ${v}`);
      out[name] = d;
    } else if (type === 'bool') {
      if (v !== 'true' && v !== 'false') throw new ValidationError(`${name} inválido: ${v}`);
      out[name] = v === 'true';
    } else {
      out[name] = v;
    }
  }
  return { limit, offset, q, sort, dir, filters: out };
}

/** Escapa los comodines de LIKE (`%`, `_`) y el escape (`\`, el de PostgreSQL por defecto). */
/**
 * Listados que además alimentan selects (catálogo, credenciales): sin `limit` la
 * API devuelve el arreglo completo de siempre; con `limit`, la página `{items, total}`.
 */
export const wantsPage = (query = {}) => query.limit !== undefined;

export function escapeLike(s) {
  return s.replace(/[\\%_]/g, '\\$&');
}

/** Constructor de WHERE parametrizado: cada valor va como `$n`; las columnas las fija el código. */
export class SqlWhere {
  constructor() {
    this.params = [];
    this.parts = [];
  }

  /** Agrega un parámetro y devuelve su placeholder. */
  param(value) {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  add(condition) {
    this.parts.push(condition);
    return this;
  }

  /** `col = $n` si hay valor. */
  eq(column, value) {
    if (value !== undefined && value !== null && value !== '') this.add(`${column} = ${this.param(value)}`);
    return this;
  }

  /** Coincidencia parcial sin distinguir mayúsculas en cualquiera de las columnas. */
  search(columns, q) {
    if (!q) return this;
    const p = this.param(`%${escapeLike(q)}%`);
    return this.add(`(${columns.map((c) => `${c} ILIKE ${p}`).join(' OR ')})`);
  }

  /** Rango de fechas: `from` desde ese instante; `to` es día inclusivo (hasta el final de ese día). */
  dateRange(column, from, to) {
    if (from) this.add(`${column} >= ${this.param(from)}`);
    if (to) this.add(`${column} < ${this.param(to)}::timestamptz + interval '1 day'`);
    return this;
  }

  get sql() {
    return this.parts.length ? `WHERE ${this.parts.join(' AND ')}` : '';
  }
}

/**
 * ORDER BY a partir de una clave permitida. Los vacíos van al final en ambos
 * sentidos; `tieBreaker` hace el orden estable entre páginas.
 */
export function orderBy(columns, sort, dir, fallback, tieBreaker) {
  const key = sort ?? fallback.sort;
  const d = dir ?? (sort ? 'asc' : fallback.dir);
  return `ORDER BY ${columns[key]} ${d === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, ${tieBreaker}`;
}

/**
 * Ejecuta un listado paginado: `select` es el SELECT…FROM…JOIN sin WHERE, `where`
 * un SqlWhere y `order` el ORDER BY. Devuelve { items, total }.
 */
export async function pagedQuery(query, { select, countFrom, where, order, limit, offset }) {
  const { rows: countRows } = await query(`SELECT count(*)::int AS total FROM ${countFrom} ${where.sql}`, where.params);
  const n = where.params.length;
  const { rows } = await query(
    `${select} ${where.sql} ${order} LIMIT $${n + 1} OFFSET $${n + 2}`,
    [...where.params, limit, offset],
  );
  return { items: rows, total: countRows[0]?.total ?? 0 };
}
