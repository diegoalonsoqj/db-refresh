import { useEffect, useRef } from 'react';
import { IconClose } from './icons.jsx';

const openModals = [];

/**
 * Diálogo centrado con overlay (patrón de db-keeper): cabecera, cuerpo con
 * scroll y pie opcional para las acciones. Cierra con Escape o click fuera.
 * `size`: sm | md (por defecto) | lg. `wide` se mantiene como alias de lg.
 */
export default function Modal({ title, onClose, children, footer, size, wide }) {
  // onClose suele ser una arrow nueva en cada render: se guarda en una ref para
  // no re-suscribir el listener (y no tocar el overflow del body) en cada tecla.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    openModals.push(closeRef);
    // Con modales apilados (confirmación sobre otro modal) Escape cierra solo el de arriba.
    const onKey = (e) => {
      if (e.key === 'Escape' && openModals[openModals.length - 1] === closeRef) closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      openModals.splice(openModals.indexOf(closeRef), 1);
    };
  }, []);

  const cls = size ?? (wide ? 'lg' : 'md');

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className={`modal modal-${cls}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="btn ghost small icon-btn" onClick={onClose} aria-label="Cerrar"><IconClose /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
