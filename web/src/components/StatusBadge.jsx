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

export default function StatusBadge({ status }) {
  return <span className={`badge ${status}`}>{LABEL[status] ?? status}</span>;
}
