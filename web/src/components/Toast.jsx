import { createContext, useCallback, useContext, useMemo, useState } from 'react';

// Avisos flotantes temporales (patrón de db-keeper) para confirmaciones breves
// como «Guardado». Los resultados que hay que leer (pruebas, salida de scripts,
// log del job) se quedan en la página.
const ToastCtx = createContext(null);
const DURATION_MS = 4500;
let seq = 0;

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);

  const remove = useCallback((id) => setItems((x) => x.filter((t) => t.id !== id)), []);
  const push = useCallback((kind, message) => {
    const id = ++seq;
    setItems((x) => [...x, { id, kind, message }]);
    setTimeout(() => remove(id), DURATION_MS);
  }, [remove]);

  const api = useMemo(() => ({
    success: (m) => push('success', m),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
  }), [push]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => remove(t.id)} title="Cerrar">
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>');
  return ctx;
}
