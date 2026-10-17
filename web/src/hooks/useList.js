import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';

// Carga una lista (o un listado paginado `{items, total}`) con recarga manual.
// `path` nulo = no cargar (p.ej. sin permiso). Al cambiar `path` (filtros/página)
// se conservan los datos anteriores hasta que llegan los nuevos.
export function useList(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(() => {
    setError(null);
    if (!path) return Promise.resolve();
    return api.get(path).then(setData).catch((e) => setError(e.message));
  }, [path]);

  useEffect(() => { reload(); }, [reload]);

  return { data, error, reload, setError };
}
