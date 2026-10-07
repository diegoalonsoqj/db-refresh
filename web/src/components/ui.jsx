import { useId } from 'react';
import Modal from './Modal.jsx';
import { IconPlus } from './icons.jsx';

/**
 * Cabecera de una página/pestaña (patrón de db-keeper): texto informativo a la
 * izquierda (p.ej. «3 proyecto(s)») y acciones a la derecha.
 */
export function PageHead({ info, children }) {
  return (
    <div className="page-head">
      {info != null && <span className="page-info muted small">{info}</span>}
      <div className="page-actions">{children}</div>
    </div>
  );
}

/** Botón principal «Nuevo …» con icono +. */
export function NewButton({ children, ...props }) {
  return (
    <button type="button" className="btn primary" {...props}>
      <IconPlus size={16} /> {children}
    </button>
  );
}

/** Acción de fila con solo icono; `label` va como tooltip y aria-label. */
export function IconButton({ icon: Icon, label, title, danger, ...props }) {
  return (
    <button
      type="button"
      className={`icon-action ${danger ? 'danger' : ''}`}
      title={title ?? label}
      aria-label={label}
      {...props}
    >
      <Icon size={16} />
    </button>
  );
}

/**
 * Modal con formulario: el cuerpo es una rejilla de 2 columnas (`.form-grid`,
 * `className="full"` para ocupar el ancho) y Cancelar/Guardar van en el pie.
 * El botón de enviar está fuera del <form> pero ligado con `form=id`, así que
 * Enter y las validaciones nativas (required, type=email…) siguen igual.
 * `actions`: botones extra a la izquierda del pie (p.ej. «Probar conexión»).
 */
export function FormModal({
  title, onClose, onSubmit, busy, error, submitLabel = 'Guardar', size, actions, autoComplete, children,
}) {
  const id = useId();
  return (
    <Modal
      title={title}
      onClose={onClose}
      size={size}
      footer={(
        <>
          {actions && <div className="modal-foot-start">{actions}</div>}
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" form={id} className="btn primary" disabled={busy}>{submitLabel}</button>
        </>
      )}
    >
      <form id={id} className="form-grid" onSubmit={onSubmit} autoComplete={autoComplete}>
        {children}
        {error && <div className="alert error full">{error}</div>}
      </form>
    </Modal>
  );
}
