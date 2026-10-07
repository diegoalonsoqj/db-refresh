import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { PageHead } from '../components/ui.jsx';

export default function AuditPage() {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/audit').then((d) => setEntries(d.entries)).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="alert error">{error}</div>;
  if (!entries) return <div className="muted">Cargando…</div>;

  return (
    <div className="page-fill">
      <PageHead info={`Últimas ${entries.length} acciones sensibles.`} />
      <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Fecha</th><th>Actor</th><th>Acción</th><th>Entidad</th><th>IP</th><th>Status</th></tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td className="muted small">{new Date(e.created_at).toLocaleString()}</td>
              <td className="small">{e.actor_email ?? <span className="muted">—</span>}</td>
              <td className="mono small">{e.action}</td>
              <td className="small">{e.entity}</td>
              <td className="mono small muted">{e.ip_address}</td>
              <td className="mono small">{e.metadata?.status ?? e.metadata?.reason ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
