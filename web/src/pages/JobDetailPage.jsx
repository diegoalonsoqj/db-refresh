import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.jsx';
import { IconArrowLeft, IconClose } from '../components/icons.jsx';
import { useAuth } from '../auth/AuthContext.jsx';

const LEVEL_LABEL = { info: 'INFO', warning: 'WARN', error: 'ERROR' };
// Los eventos antiguos se guardaron con emojis y separadores '===': se limpian al mostrarlos.
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;
const cleanMessage = (m) =>
  String(m).replace(EMOJI_RE, '').replace(/^[\s=]+|[\s=]+$/g, '').replace(/\s{2,}/g, ' ');

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

export default function JobDetailPage() {
  const { id } = useParams();
  const [job, setJob] = useState(null);
  const [events, setEvents] = useState([]);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState(null);
  const logRef = useRef(null);
  const { user } = useAuth();
  const canCancel = user && ['operator', 'admin'].includes(user.role);

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

  const cancelJob = async () => {
    const running = job.status === 'running';
    const msg = running
      ? '¿Cancelar este restore?\n\nSe detendrá la operación en curso (import de Cloud SQL o pg_restore/psql). ' +
        'La BD que se esté restaurando en ese momento puede quedar vacía o incompleta; ' +
        'las siguientes no se tocarán y no se ejecutarán los post-scripts.'
      : '¿Cancelar este restore? Aún no ha empezado: no se modificará ninguna BD.';
    if (!confirm(msg)) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await api.post(`/restores/${id}/cancel`);
      setJob(await api.get(`/restores/${id}`));
    } catch (err) {
      setCancelError(err.message);
    } finally {
      setCancelling(false);
    }
  };

  if (!job) return <div className="muted">Cargando…</div>;
  const active = !TERMINAL.has(job.status);
  const cancelRequested = active && !!job.cancel_requested_at;
  const hasOwner = job.items.some((it) => it.import_user);

  return (
    <div>
      <div className="row between">
        <h2>
          Job <span className="mono">{job.id.slice(0, 8)}</span> <StatusBadge status={job.status} warning={job.warning_message} />
        </h2>
        <div className="row">
          {canCancel && active && (
            <button type="button" className="btn danger" onClick={cancelJob} disabled={cancelling || cancelRequested}>
              <IconClose /> {cancelRequested ? 'Cancelando…' : 'Cancelar restore'}
            </button>
          )}
          <Link className="btn ghost" to="/jobs"><IconArrowLeft /> Historial</Link>
        </div>
      </div>
      <div className="muted small">
        Método: {job.method === 'native' ? 'restore nativo (pg_restore / psql)' : 'import de Cloud SQL'}
        {job.bucket_path && <> · origen <span className="mono">{job.bucket_path}</span></>}
      </div>
      {cancelError && <div className="alert error">{cancelError}</div>}
      {cancelRequested && (
        <div className="alert warn">
          Cancelación solicitada: el job se detendrá en unos segundos (se espera a que Cloud SQL confirme la cancelación de la operación en curso).
        </div>
      )}
      {job.error_message && <div className={`alert ${job.status === 'cancelled' ? 'warn' : 'error'}`}>{job.error_message}</div>}
      {job.warning_message && <div className="alert warn">{job.warning_message}</div>}

      <h3>Bases de datos</h3>
      <table className="table">
        <thead>
          <tr><th>#</th><th>Backup</th><th>Destino</th>{hasOwner && <th>Owner</th>}<th>Estado</th></tr>
        </thead>
        <tbody>
          {job.items.map((it) => (
            <tr key={it.id}>
              <td>{it.seq}</td>
              <td className="mono small">{it.backup_file}</td>
              <td className="mono">
                {it.target_db}
                {it.scope === 'schema' && <span className="muted small"> · esquema {it.schema_name}</span>}
                {it.drop_via_sql && <span className="muted small"> · borrado por SQL</span>}
                {it.fix_orphans && (
                  <span className="muted small"> · corrige usuarios huérfanos{it.orphan_db_owner ? ` (owner ${it.orphan_db_owner})` : ''}</span>
                )}
              </td>
              {hasOwner && <td className="mono small">{it.import_user ?? <span className="muted">por defecto</span>}</td>}
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
              <span className="log-time">{new Date(e.created_at).toLocaleTimeString()}</span>
              <span className={`log-level ${e.level}`}>{LEVEL_LABEL[e.level] ?? e.level}</span>
              <span className="log-msg">{cleanMessage(e.message)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
