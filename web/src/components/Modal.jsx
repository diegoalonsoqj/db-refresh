import { IconClose } from './icons.jsx';

export default function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal ${wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="btn ghost small icon-btn" onClick={onClose} aria-label="Cerrar"><IconClose /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
