import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import Modal from '../../components/Modal.jsx';

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
          </div>
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
    </Modal>
  );
}
