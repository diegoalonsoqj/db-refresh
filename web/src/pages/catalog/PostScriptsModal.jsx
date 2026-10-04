import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import Modal from '../../components/Modal.jsx';
import { IconLaunch } from '../../components/icons.jsx';

const LEVEL_LABEL = { info: 'INFO', warning: 'WARN', error: 'ERROR' };

// Post-scripts SQL de una instancia: se ejecutan en orden tras un job en el que
// TODAS las restauraciones salieron OK (equivale a scripts_extras del script original).
const empty = { name: '', databaseName: '', sortOrder: 0, isActive: true, sqlText: '' };

const DB_PLACEHOLDER = { sqlserver: 'vacío = master', postgres: 'vacío = postgres', mysql: 'vacío = sin BD por defecto' };
const SQL_PLACEHOLDER = {
  sqlserver: "EXEC msdb.dbo.sp_start_job @job_name = 'Permisos - Homologacion';\nGO",
  postgres: 'ALTER SCHEMA public OWNER TO app_owner;\nGRANT USAGE ON SCHEMA public TO app_reader;',
  mysql: "GRANT SELECT ON mi_bd.* TO 'app_reader'@'%';",
};
const SQL_HINT = {
  sqlserver: 'Lotes separados por GO en línea sola. Los PRINT aparecen en el log del job.',
  postgres: 'Admite varias sentencias. Los RAISE NOTICE aparecen en el log del job.',
  mysql: 'Admite varias sentencias separadas por ";". Indica la BD o usa nombres calificados.',
};

export default function PostScriptsModal({ instance, onClose }) {
  const [scripts, setScripts] = useState(null);
  const [editing, setEditing] = useState(null); // null | {} (nuevo) | script
  const [form, setForm] = useState(empty);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  // Ejecución manual: { name, pending } mientras corre; luego { name, ok, lines, error, durationMs }.
  const [run, setRun] = useState(null);

  const base = `/instances/${instance.id}/post-scripts`;
  const load = () => api.get(base).then(setScripts).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const nextOrder = () => ((scripts ?? []).reduce((m, s) => Math.max(m, s.sort_order), 0) + 10);
  const openNew = () => { setForm({ ...empty, sortOrder: nextOrder() }); setEditing({}); setErr(null); };
  const openEdit = (s) => {
    setForm({
      name: s.name, databaseName: s.database_name ?? '', sortOrder: s.sort_order,
      isActive: s.is_active, sqlText: s.sql_text,
    });
    setEditing(s); setErr(null);
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const body = { ...form, sortOrder: Number(form.sortOrder) || 0 };
    try {
      if (editing.id) await api.put(`${base}/${editing.id}`, body);
      else await api.post(base, body);
      setEditing(null); await load();
    } catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  };

  // Ejecuta YA la versión guardada del script en la instancia (aunque esté inactivo).
  const runScript = async (s) => {
    if (!confirm(`¿Ejecutar ahora "${s.name}" en la instancia ${instance.instance_name}?\n\nSe ejecuta la versión guardada del script, con la credencial de la instancia.`)) return;
    setRun({ name: s.name, pending: true });
    try {
      setRun({ name: s.name, ...(await api.post(`${base}/${s.id}/run`, {})) });
    } catch (e) {
      setRun({ name: s.name, ok: false, error: e.message, lines: [{ level: 'error', message: e.message }] });
    }
  };

  // En edición, solo se puede ejecutar si no hay cambios sin guardar.
  const dirty = editing?.id && (
    form.name !== editing.name || (form.databaseName || null) !== (editing.database_name ?? null)
    || form.sqlText !== editing.sql_text || Number(form.sortOrder) !== editing.sort_order
    || form.isActive !== editing.is_active
  );

  const remove = async (s) => {
    if (!confirm(`¿Eliminar el post-script "${s.name}"?`)) return;
    setBusy(true); setErr(null);
    try { await api.del(`${base}/${s.id}`); await load(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const noConnection = !instance.db_host || !instance.credential_ref;

  return (
    <Modal wide title={`Post-scripts de ${instance.instance_name}`} onClose={onClose}>
      {err && <div className="alert error">{err}</div>}
      {noConnection && (
        <div className="alert warn">
          La instancia no tiene conexión SQL (IP privada + credencial). Los post-scripts se pueden preparar
          como inactivos; para activarlos, configura la conexión en la instancia.
        </div>
      )}

      {editing ? (
        <form className="stack" onSubmit={save}>
          <div className="row gap">
            <label style={{ flex: 2 }}>Nombre<input value={form.name} onChange={set('name')} autoFocus required /></label>
            <label style={{ flex: 1 }}>Orden<input type="number" step="1" value={form.sortOrder} onChange={set('sortOrder')} /></label>
          </div>
          <label>Base de datos
            <input className="mono" value={form.databaseName} onChange={set('databaseName')} placeholder={DB_PLACEHOLDER[instance.engine]} />
            <span className="muted small">Donde se conecta el script. Puede ser una de las BD restauradas.</span>
          </label>
          <label>SQL
            <textarea className="textarea" value={form.sqlText} onChange={set('sqlText')} spellCheck={false} required
              placeholder={SQL_PLACEHOLDER[instance.engine]} />
            <span className="muted small">{SQL_HINT[instance.engine]}</span>
          </label>
          <label className="checkline">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
            Activo
          </label>
          <div className="row gap">
            <button className="btn primary" disabled={busy}>Guardar</button>
            <button type="button" className="btn" onClick={() => setEditing(null)}>Cancelar</button>
            {editing.id && (
              <button type="button" className="btn" onClick={() => runScript(editing)}
                disabled={noConnection || dirty || run?.pending}
                title={dirty ? 'Guarda los cambios para ejecutar esta versión' : noConnection ? 'La instancia no tiene conexión SQL' : undefined}>
                <IconLaunch /> Ejecutar
              </button>
            )}
          </div>
          {dirty && <div className="muted small">Hay cambios sin guardar: se ejecuta la versión guardada, guarda antes para probar la nueva.</div>}
        </form>
      ) : !scripts ? <div className="muted">Cargando…</div> : (
        <>
          <p className="muted small">
            Se ejecutan en orden solo si todas las restauraciones del job salieron OK. El primer fallo detiene el resto
            y deja el job en <span className="mono">failed</span>.
          </p>
          <table className="table">
            <thead><tr><th>#</th><th>Nombre</th><th>BD</th><th>Activo</th><th /></tr></thead>
            <tbody>
              {scripts.length === 0 && <tr><td colSpan="5" className="muted">Sin post-scripts.</td></tr>}
              {scripts.map((s) => (
                <tr key={s.id}>
                  <td className="muted small">{s.sort_order}</td>
                  <td>{s.name}</td>
                  <td className="mono small">{s.database_name ?? <span className="muted">master</span>}</td>
                  <td><span className={`pill ${s.is_active ? 'on' : ''}`}>{s.is_active ? 'sí' : 'no'}</span></td>
                  <td className="actions">
                    <button className="btn ghost small" disabled={busy || noConnection || run?.pending} onClick={() => runScript(s)}
                      title={noConnection ? 'La instancia no tiene conexión SQL' : 'Ejecutar ahora en la instancia'}>Ejecutar</button>
                    <button className="btn ghost small" disabled={busy} onClick={() => openEdit(s)}>Editar</button>
                    <button className="btn ghost small" disabled={busy} onClick={() => remove(s)}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row gap">
            <button className="btn primary small" onClick={openNew}>+ Nuevo post-script</button>
          </div>
        </>
      )}

      {run && (
        <div className="run-output">
          <div className="row between">
            <strong className="small">
              Ejecución de «{run.name}»:{' '}
              {run.pending ? <span className="muted">en curso…</span>
                : run.ok ? <span className="pill on">correcta</span> : <span className="pill warn">con error</span>}
              {run.durationMs != null && <span className="muted"> · {(run.durationMs / 1000).toFixed(1)} s</span>}
            </strong>
            {!run.pending && <button type="button" className="btn ghost small" onClick={() => setRun(null)}>Cerrar</button>}
          </div>
          <div className="log run-log">
            {run.pending ? <div className="muted">Ejecutando en {instance.instance_name}…</div> : (run.lines ?? []).map((l, i) => (
              <div key={i} className={`logline ${l.level}`}>
                <span className={`log-level ${l.level}`}>{LEVEL_LABEL[l.level] ?? l.level}</span>
                <span className="log-msg">{l.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
