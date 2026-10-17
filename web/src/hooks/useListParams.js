import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

// Mismos tamaños que la API (server/lib/listQuery.js).
export const PAGE_SIZES = [10, 20, 50, 100];
export const DEFAULT_PAGE_SIZE = PAGE_SIZES[0];

/** Inicio del día local de un `AAAA-MM-DD`, en ISO (para que la API compare instantes). */
function localDayStart(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toISOString() : null;
}

/**
 * Estado de un listado (búsqueda, filtros, orden y página) guardado en la URL, como
 * db-keeper: se conserva al recargar y se puede compartir. Cambiar búsqueda, filtro
 * u orden vuelve a la primera página. `apiQuery` es el query string para la API.
 * `filters`: claves propias del listado; `dateFilters`: las que son `AAAA-MM-DD`.
 */
export function useListParams({ filters: filterKeys, defaultSort, dateFilters = [] }) {
  const [sp, setSp] = useSearchParams();

  const rawLimit = Number(sp.get('limit'));
  const limit = PAGE_SIZES.includes(rawLimit) ? rawLimit : DEFAULT_PAGE_SIZE;
  const offset = Math.max(0, Math.floor(Number(sp.get('offset')) || 0));
  const q = sp.get('q') ?? '';
  const sortParam = sp.get('sort') ?? '';
  const dirParam = sp.get('dir');
  const dir = dirParam === 'asc' || dirParam === 'desc' ? dirParam : '';
  const filterKey = filterKeys.map((k) => `${k}=${sp.get(k) ?? ''}`).join('&');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filters = useMemo(() => Object.fromEntries(filterKeys.map((k) => [k, sp.get(k) ?? ''])), [filterKey]);

  const sort = sortParam || defaultSort.key;
  const sortDir = dir || (sortParam ? 'asc' : defaultSort.dir);

  /** Aplica cambios al query string; vacío = quitar. Por defecto vuelve a la página 1. */
  const update = useCallback((patch, keepOffset = false) => {
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === '' || v == null) next.delete(k);
        else next.set(k, String(v));
      }
      if (!keepOffset) next.delete('offset');
      return next;
    }, { replace: true });
  }, [setSp]);

  const setPage = useCallback(
    (p) => update({ limit: p.limit === DEFAULT_PAGE_SIZE ? null : p.limit, offset: p.offset || null }, true),
    [update],
  );

  /** Clic en un encabezado: misma columna invierte el sentido; otra empieza en `firstDir`. */
  const toggleSort = useCallback((key, firstDir = 'asc') => {
    const nextDir = key === sort ? (sortDir === 'asc' ? 'desc' : 'asc') : firstDir;
    const isDefault = key === defaultSort.key && nextDir === defaultSort.dir;
    update(isDefault ? { sort: null, dir: null } : { sort: key, dir: nextDir });
  }, [sort, sortDir, defaultSort.key, defaultSort.dir, update]);

  /** Quita búsqueda y filtros (conserva el orden y el tamaño de página). */
  const clear = useCallback(
    () => update(Object.fromEntries(['q', ...filterKeys].map((k) => [k, null]))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [update, filterKeys.join(',')],
  );

  const apiQuery = useMemo(() => {
    const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (q) qs.set('q', q);
    if (sortParam) qs.set('sort', sortParam);
    if (dir) qs.set('dir', dir);
    for (const k of filterKeys) {
      const v = filters[k];
      if (!v) continue;
      if (dateFilters.includes(k)) {
        const iso = localDayStart(v);
        if (iso) qs.set(k, iso);
      } else qs.set(k, v);
    }
    return qs.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit, offset, q, sortParam, dir, filters]);

  const hasFilters = Boolean(q) || filterKeys.some((k) => Boolean(filters[k]));
  // Props comunes de <SortTh>.
  const sortProps = { sort, dir: sortDir, onSort: toggleSort };

  return { limit, offset, q, filters, sort, sortDir, sortProps, hasFilters, apiQuery, update, setPage, toggleSort, clear };
}
