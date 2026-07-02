import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.jsx';

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

export default function JobDetailPage() {
  const { id } = useParams();
  const [job, setJob] = useState(null);
  const [events, setEvents] = useState([]);
  const logRef = useRef(null);

  // Estado del job: refresca cada 3s hasta que sea terminal (item statuses).
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const j = await api.get(`/restores/${id}`);
        if (stop) return;
        setJob(j);
        if (j && !TERMINAL.has(j.status)) setTimeout(load, 3000);
      } catch {
        /* reintenta en el próximo ciclo */
      }
    };
    load();
    return () => { stop = true; };
  }, [id]);

  // Log en vivo por SSE. El server nombra el evento por nivel (info/warning/error).
  useEffect(() => {
    const es = new EventSource(`/api/restores/${id}/events`);
    const onEvt = (e) => {
      try {
        const d = JSON.parse(e.data);
        setEvents((prev) => [...prev, d]);
      } catch { /* ignora líneas no-JSON */ }
    };
    ['info', 'warning', 'error'].forEach((lvl) => es.addEventListener(lvl, onEvt));
    es.onmessage = onEvt;
    return () => es.close();
  }, [id]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  if (!job) return <div className="muted">Cargando…</div>;

  return (
    <div>
      <div className="row between">
        <h2>
          Job <span className="mono">{job.id.slice(0, 8)}</span> <StatusBadge status={job.status} />
        </h2>
        <Link className="btn ghost" to="/jobs">← Historial</Link>
      </div>
      {job.error_message && <div className="alert error">{job.error_message}</div>}

      <h3>Bases de datos</h3>
      <table className="table">
        <thead>
          <tr><th>#</th><th>Backup</th><th>Destino</th><th>Estado</th></tr>
        </thead>
        <tbody>
          {job.items.map((it) => (
            <tr key={it.id}>
              <td>{it.seq}</td>
              <td className="mono small">{it.backup_file}</td>
              <td className="mono">{it.target_db}</td>
              <td><StatusBadge status={it.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Progreso en vivo</h3>
      <div className="log" ref={logRef}>
        {events.length === 0 ? (
          <div className="muted">Esperando eventos…</div>
        ) : (
          events.map((e, i) => (
            <div key={i} className={`logline ${e.level}`}>
              <span className="muted small">{new Date(e.created_at).toLocaleTimeString()}</span> {e.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
