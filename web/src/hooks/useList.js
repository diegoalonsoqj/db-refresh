import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';

// Carga una lista (endpoint que devuelve un array) con recarga manual.
export function useList(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(() => {
    setError(null);
    return api.get(path).then(setData).catch((e) => setError(e.message));
  }, [path]);

  useEffect(() => { reload(); }, [reload]);

  return { data, error, reload, setError };
}
