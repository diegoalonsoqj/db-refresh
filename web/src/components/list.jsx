// Piezas comunes de los listados (como db-keeper): barra de búsqueda y filtros,
// encabezado de columna ordenable y paginación. El filtrado, el orden y la
// paginación los hace la API; el estado vive en la URL (hooks/useListParams.js).
import { useEffect, useRef, useState } from 'react';
import { PAGE_SIZES } from '../hooks/useListParams.js';

const SEARCH_DEBOUNCE_MS = 300;

/** Input de texto que aplica su valor al dejar de escribir o con Enter (evita una consulta por tecla). */
export function DebouncedInput({ value, onCommit, type = 'text', placeholder }) {
  const [text, setText] = useState(value);
  const timer = useRef(null);

  // La URL manda: si cambia desde fuera (Limpiar, atrás/adelante), se refleja en el input.
  useEffect(() => setText(value), [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const commitNow = (v) => {
    clearTimeout(timer.current);
    if (v.trim() !== value) onCommit(v.trim());
  };

  return (
    <input
      type={type}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => commitNow(v), SEARCH_DEBOUNCE_MS);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') commitNow(text); }}
    />
  );
}

/**
 * Barra de un listado: buscador (sin `onSearch` no se muestra), filtros propios
 * (`children`: `<label>` con su select/input) y «Limpiar» si hay alguno activo.
 */
export function ListToolbar({ search = '', onSearch, searchPlaceholder, hasFilters, onClear, children }) {
  return (
    <div className="filters list-toolbar" role="search">
      {onSearch && (
        <label className="list-search">
          Buscar
          <DebouncedInput type="search" value={search} onCommit={onSearch} placeholder={searchPlaceholder} />
        </label>
      )}
      {children}
      {hasFilters && <button type="button" className="btn" onClick={onClear}>Limpiar</button>}
    </div>
  );
}

/** Select de filtro con opción «Todos» (vacío = sin filtro). `options`: [{ value, label }]. */
export function FilterSelect({ label, value, onChange, options, allLabel = 'Todos' }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/**
 * Encabezado de columna ordenable (el orden lo aplica la API sobre todo el listado).
 * `firstDir`: sentido del primer clic (fechas suelen empezar por la más reciente).
 */
export function SortTh({ sortKey, sort, dir, onSort, firstDir = 'asc', children }) {
  const active = sort === sortKey;
  return (
    <th aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`sort-btn${active ? ' active' : ''}`} onClick={() => onSort(sortKey, firstDir)}>
        {children}
        <span className="sort-icon" aria-hidden="true">{active ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}

/** Paginación server-side: tamaño de página, rango y Anterior/Siguiente. */
export function Pagination({ total, limit, offset, onChange }) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.floor(offset / limit) + 1;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);

  return (
    <div className="pagination">
      <label className="pagination-size">
        Por página
        <select value={limit} onChange={(e) => onChange({ limit: Number(e.target.value), offset: 0 })}>
          {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <span className="pagination-range">{from}–{to} de {total}</span>
      <div className="pagination-nav">
        <button type="button" className="btn small" disabled={page <= 1}
          onClick={() => onChange({ limit, offset: Math.max(0, offset - limit) })}>Anterior</button>
        <button type="button" className="btn small" disabled={page >= totalPages}
          onClick={() => onChange({ limit, offset: offset + limit })}>Siguiente</button>
      </div>
    </div>
  );
}

/** Fila «sin registros» de una tabla filtrable. */
export function EmptyRow({ colSpan, filtered, children = 'Sin registros.' }) {
  return (
    <tr>
      <td colSpan={colSpan} className="muted">{filtered ? 'Sin resultados para la búsqueda o los filtros.' : children}</td>
    </tr>
  );
}
