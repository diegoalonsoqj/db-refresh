const LABEL = {
  pending: 'Pendiente',
  running: 'En curso',
  succeeded: 'OK',
  failed: 'Fallido',
  cancelled: 'Cancelado',
  dropping: 'Eliminando',
  importing: 'Importando',
  post_scripts: 'Post-scripts',
};

/** `warning`: el job terminó bien pero se omitió algún paso (p.ej. sin conexión SQL). */
export default function StatusBadge({ status, warning = null }) {
  if (status === 'succeeded' && warning) {
    return <span className="badge warned" title={warning}>OK con avisos</span>;
  }
  return <span className={`badge ${status}`}>{LABEL[status] ?? status}</span>;
}
