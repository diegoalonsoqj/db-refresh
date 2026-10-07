import { createContext, useCallback, useContext, useRef, useState } from 'react';
import Modal from './Modal.jsx';

// Sustituto de window.confirm con el estilo de la app (patrón de db-keeper).
// Uso: `if (!(await confirm({ message, danger: true }))) return;`
// Cerrar el diálogo (Escape, click fuera, X o Cancelar) equivale a «no».
const ConfirmCtx = createContext(null);

export function ConfirmProvider({ children }) {
  const [opts, setOpts] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback((o) => new Promise((resolve) => {
    resolver.current = resolve;
    setOpts(o);
  }), []);

  const close = (value) => {
    setOpts(null);
    resolver.current?.(value);
    resolver.current = null;
  };

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {opts && (
        <Modal
          title={opts.title ?? 'Confirmar'}
          size="sm"
          onClose={() => close(false)}
          footer={(
            <>
              <button type="button" className="btn" onClick={() => close(false)}>Cancelar</button>
              <button
                type="button"
                className={`btn ${opts.danger ? 'danger-solid' : 'primary'}`}
                onClick={() => close(true)}
                autoFocus
              >
                {opts.confirmLabel ?? 'Aceptar'}
              </button>
            </>
          )}
        >
          <p className="confirm-msg">{opts.message}</p>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error('useConfirm debe usarse dentro de <ConfirmProvider>');
  return ctx;
}
