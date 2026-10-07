import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.jsx';

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
    <div>
      {jobs.length === 0 ? (
        <p className="muted">Sin jobs todavía.</p>
      ) : (
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
                <td><Link className="btn ghost small" to={`/jobs/${j.id}`}>Ver</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
