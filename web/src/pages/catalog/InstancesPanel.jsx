import { useState } from 'react';
import { api } from '../../api/client.js';
import { useList } from '../../hooks/useList.js';
import Modal from '../../components/Modal.jsx';
import LinkBucketsModal from './LinkBucketsModal.jsx';
import PostScriptsModal from './PostScriptsModal.jsx';

const ENGINES = ['sqlserver', 'postgres', 'mysql'];
const empty = { projectRef: '', instanceName: '', engine: 'postgres', dbHost: '', dbPort: '', adminUser: '', secretRef: '', isActive: true };

export default function InstancesPanel({ projects, buckets }) {
  const { data: instances, error, reload } = useList('/instances');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [formErr, setFormErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [linkFor, setLinkFor] = useState(null);
  const [scriptsFor, setScriptsFor] = useState(null);

  const openNew = () => { setForm({ ...empty, projectRef: projects[0]?.id ?? '' }); setEditing({}); setFormErr(null); };
  const openEdit = (i) => {
    setForm({
      projectRef: i.project_ref, instanceName: i.instance_name, engine: i.engine, dbHost: i.db_host ?? '',
      dbPort: i.db_port ?? '', adminUser: i.admin_user ?? '', secretRef: i.secret_ref ?? '', isActive: i.is_active,
    });
    setEditing(i); setFormErr(null);
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setFormErr(null);
    const body = { ...form, dbPort: form.dbPort === '' ? null : Number(form.dbPort) };
    try {
      if (editing.id) await api.put(`/instances/${editing.id}`, body);
      else await api.post('/instances', body);
      setEditing(null); await reload();
    } catch (err) { setFormErr(err.message); }
    finally { setBusy(false); }
  };

  const remove = async (i) => {
    if (!confirm(`¿Eliminar la instancia ${i.instance_name}?`)) return;
    try { await api.del(`/instances/${i.id}`); await reload(); }
    catch (err) { alert(err.message); }
  };

  if (error) return <div className="alert error">{error}</div>;
  if (!instances) return <div className="muted">Cargando…</div>;

  return (
    <div>
      <div className="toolbar">
        <span className="muted small">{instances.length} instancia(s)</span>
        <button className="btn primary small" onClick={openNew} disabled={!projects.length}>+ Nueva instancia</button>
      </div>
      <table className="table">
        <thead><tr><th>Instancia</th><th>Motor</th><th>Host</th><th>Proyecto</th><th>Activo</th><th /></tr></thead>
        <tbody>
          {instances.map((i) => (
            <tr key={i.id}>
              <td className="mono">{i.instance_name}</td>
              <td>{i.engine}</td>
              <td className="mono small muted">
                {i.db_host ? `${i.db_host}${i.db_port ? `:${i.db_port}` : ''}` : <span title="Sin conexión SQL: solo restore (sin post-scripts)">—</span>}
              </td>
              <td>{i.project_id}</td>
              <td><span className={`pill ${i.is_active ? 'on' : ''}`}>{i.is_active ? 'sí' : 'no'}</span></td>
              <td className="actions">
                <button className="btn ghost small" onClick={() => setLinkFor(i)}>Buckets</button>
                <button className="btn ghost small" onClick={() => setScriptsFor(i)}>Post-scripts</button>
                <button className="btn ghost small" onClick={() => openEdit(i)}>Editar</button>
                <button className="btn ghost small" onClick={() => remove(i)}>Eliminar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <Modal title={editing.id ? 'Editar instancia' : 'Nueva instancia'} onClose={() => setEditing(null)}>
          <form className="stack" onSubmit={save}>
            <label>Proyecto
              <select value={form.projectRef} onChange={set('projectRef')} required>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.project_id}</option>)}
              </select>
            </label>
            <label>Nombre de instancia<input value={form.instanceName} onChange={set('instanceName')} autoFocus required /></label>
            <label>Motor
              <select value={form.engine} onChange={set('engine')}>
                {ENGINES.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </label>
            <div className="muted small">
              <strong>Conexión SQL — solo para post-scripts (opcional).</strong> El restore (drop + import del
              backup) usa el Cloud SQL Admin API con la service account de Ajustes y no la necesita. Rellena
              los tres campos o déjalos vacíos.
            </div>
            <div className="row gap">
              <label style={{ flex: 2 }}>Host<input className="mono" value={form.dbHost} onChange={set('dbHost')} placeholder="IP privada (opc.)" /></label>
              <label style={{ flex: 1 }}>Puerto<input type="number" value={form.dbPort} onChange={set('dbPort')} placeholder="opc." /></label>
            </div>
            <label>Usuario admin<input value={form.adminUser} onChange={set('adminUser')} placeholder="opc." /></label>
            <label>Secret ref (referencia al password, NO el password)
              <input className="mono" value={form.secretRef} onChange={set('secretRef')} placeholder="sm://projects/<p>/secrets/<s> (opc.)" />
              <span className="muted small">
                <span className="mono">sm://projects/&lt;p&gt;/secrets/&lt;s&gt;[/versions/&lt;v&gt;]</span> (Secret Manager) o{' '}
                <span className="mono">env:NOMBRE</span> (variable de entorno, dev).
              </span>
            </label>
            <label className="checkline">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
              Activo
            </label>
            {formErr && <div className="alert error">{formErr}</div>}
            <div className="row gap">
              <button className="btn primary" disabled={busy}>Guardar</button>
              <button type="button" className="btn" onClick={() => setEditing(null)}>Cancelar</button>
            </div>
          </form>
        </Modal>
      )}

      {scriptsFor && <PostScriptsModal instance={scriptsFor} onClose={() => setScriptsFor(null)} />}
      {linkFor && <LinkBucketsModal instance={linkFor} allBuckets={buckets} onClose={() => setLinkFor(null)} />}
    </div>
  );
}
