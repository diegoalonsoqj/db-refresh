import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.jsx';
import { PageHead } from '../components/ui.jsx';
import { IconView } from '../components/icons.jsx';

export default function JobsPage() {
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let stop = false;
    const load = () =>
      api.get('/restores')
        .then((d) => { if (!stop) setJobs(d.jobs); })
        .catch((e) => { if (!stop) setError(e.message); });
    load();
    const t = setInterval(load, 5000); // refresco del historial
    return () => { stop = true; clearInterval(t); };
  }, []);

  if (error) return <div className="alert error">{error}</div>;
  if (!jobs) return <div className="muted">Cargando…</div>;

  return (
    <div className="page-fill">
      <PageHead info={`${jobs.length} job(s) · se actualiza cada 5 s`} />
      {jobs.length === 0 ? (
        <p className="muted">Sin jobs todavía.</p>
      ) : (
        <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Estado</th><th>Instancia</th><th>Motor</th><th>Creado</th><th /></tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td><StatusBadge status={j.status} warning={j.warning_message} /></td>
                <td>
                  {j.instance_name}
                  <div className="muted small">{j.project_id}</div>
                </td>
                <td>{j.engine}</td>
                <td className="muted small">{new Date(j.created_at).toLocaleString()}</td>
                <td className="row-actions">
                  <Link className="icon-action" to={`/jobs/${j.id}`} title="Ver detalle" aria-label="Ver detalle"><IconView size={16} /></Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
