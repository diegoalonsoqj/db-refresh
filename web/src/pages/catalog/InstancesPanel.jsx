import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useList } from '../../hooks/useList.js';
import Modal from '../../components/Modal.jsx';
import LinkBucketsModal from './LinkBucketsModal.jsx';
import ScriptsModal from './ScriptsModal.jsx';
import { useConfirm } from '../../components/ConfirmDialog.jsx';
import { useToast } from '../../components/Toast.jsx';

const ENGINES = ['sqlserver', 'postgres', 'mysql'];
const DEFAULT_PORTS = { sqlserver: 1433, postgres: 5432, mysql: 3306 };
const empty = { projectRef: '', instanceName: '', engine: 'postgres', dbHost: '', dbPort: '', credentialRef: '', isActive: true };

// Resultado de "Probar conexión": { ok, message|error }.
function TestResult({ result }) {
  if (!result) return null;
  if (result.pending) return <div className="muted small">Probando conexión…</div>;
  return <div className={`alert small ${result.ok ? 'success' : 'error'}`}>{result.ok ? result.message : result.error}</div>;
}

export default function InstancesPanel({ projects, buckets }) {
  const confirm = useConfirm();
  const toast = useToast();
  const { data: instances, error, reload } = useList('/instances');
  const { data: credentials } = useList('/credentials');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [formErr, setFormErr] = useState(null);
  const [formTest, setFormTest] = useState(null);
  const [rowTest, setRowTest] = useState({}); // id -> resultado
  const [busy, setBusy] = useState(false);
  const [linkFor, setLinkFor] = useState(null);
  const [scriptsFor, setScriptsFor] = useState(null);

  const openNew = () => {
    setForm({ ...empty, projectRef: projects[0]?.id ?? '' });
    setEditing({}); setFormErr(null); setFormTest(null);
  };
  const openEdit = (i) => {
    setForm({
      projectRef: i.project_ref, instanceName: i.instance_name, engine: i.engine, dbHost: i.db_host ?? '',
      dbPort: i.db_port ?? '', credentialRef: i.credential_ref ?? '', isActive: i.is_active,
    });
    setEditing(i); setFormErr(null); setFormTest(null);
  };
  const set = (k) => (e) => { setFormTest(null); setForm((f) => ({ ...f, [k]: e.target.value })); };
  // Cambiar de motor invalida la credencial elegida (las credenciales son por motor).
  const setEngine = (e) => { setFormTest(null); setForm((f) => ({ ...f, engine: e.target.value, credentialRef: '' })); };

  const engineCreds = (credentials ?? []).filter((c) => c.engine === form.engine);

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setFormErr(null);
    const body = { ...form, dbPort: form.dbPort === '' ? null : Number(form.dbPort), credentialRef: form.credentialRef || null };
    try {
      if (editing.id) await api.put(`/instances/${editing.id}`, body);
      else await api.post('/instances', body);
      setEditing(null); await reload();
    } catch (err) { setFormErr(err.message); }
    finally { setBusy(false); }
  };

  // Prueba la credencial elegida contra el host del formulario (sin guardar).
  const testForm = async () => {
    setFormTest({ pending: true });
    try {
      setFormTest(await api.post(`/credentials/${form.credentialRef}/test`, { host: form.dbHost, port: form.dbPort || null }));
    } catch (err) { setFormTest({ ok: false, error: err.message }); }
  };

  // Prueba la conexión guardada de una instancia.
  const testRow = async (i) => {
    setRowTest((r) => ({ ...r, [i.id]: { pending: true } }));
    let res;
    try { res = await api.post(`/instances/${i.id}/test-connection`, {}); }
    catch (err) { res = { ok: false, error: err.message }; }
    setRowTest((r) => ({ ...r, [i.id]: res }));
  };

  const remove = async (i) => {
    if (!(await confirm({ message: `¿Eliminar la instancia ${i.instance_name}?`, confirmLabel: 'Eliminar', danger: true }))) return;
    try { await api.del(`/instances/${i.id}`); await reload(); }
    catch (err) { toast.error(err.message); }
  };

  if (error) return <div className="alert error">{error}</div>;
  if (!instances) return <div className="muted">Cargando…</div>;

  return (
    <div>
      <div className="toolbar">
        <span className="muted small">{instances.length} instancia(s)</span>
        <button className="btn primary small" onClick={openNew} disabled={!projects.length}>Nueva instancia</button>
      </div>
      <table className="table">
        <thead><tr><th>Instancia</th><th>Motor</th><th>Conexión SQL</th><th>Proyecto</th><th>Activo</th><th /></tr></thead>
        <tbody>
          {instances.map((i) => (
            <tr key={i.id}>
              <td className="mono">{i.instance_name}</td>
              <td>{i.engine}</td>
              <td className="small">
                {i.db_host && i.credential_ref ? (
                  <>
                    <div className="mono">{i.db_host}{i.db_port ? `:${i.db_port}` : ''}</div>
                    <div className="muted">{i.credential_name} ({i.credential_username})</div>
                  </>
                ) : (
                  <span className="muted" title="Sin conexión SQL: solo restore, sin scripts pre/post">
                    {i.db_host ? `${i.db_host} · sin credencial` : 'No configurada'}
                  </span>
                )}
                <TestResult result={rowTest[i.id]} />
              </td>
              <td>{i.project_id}</td>
              <td><span className={`pill ${i.is_active ? 'on' : ''}`}>{i.is_active ? 'sí' : 'no'}</span></td>
              <td className="actions">
                <button className="btn ghost small" onClick={() => testRow(i)} disabled={!i.db_host || !i.credential_ref}>Probar conexión</button>
                <button className="btn ghost small" onClick={() => setLinkFor(i)}>Buckets</button>
                <button className="btn ghost small" onClick={() => setScriptsFor(i)}>Scripts</button>
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
              <select value={form.engine} onChange={setEngine}>
                {ENGINES.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </label>
            <div className="muted small">
              <strong>Conexión SQL — solo para scripts pre/post (opcional).</strong> El restore (drop + import del
              backup) usa el Cloud SQL Admin API con la service account de Ajustes y no la necesita. Indica la IP
              privada y la credencial; sin credencial la instancia no ejecuta scripts pre/post.
            </div>
            <div className="row gap" style={{ alignItems: 'flex-start' }}>
              <label style={{ flex: 2 }}>Host (IP privada)<input className="mono" value={form.dbHost} onChange={set('dbHost')} placeholder="10.x.x.x" /></label>
              <label style={{ flex: 1 }}>Puerto<input type="number" value={form.dbPort} onChange={set('dbPort')} placeholder={String(DEFAULT_PORTS[form.engine])} /></label>
            </div>
            <label>Credencial
              <select value={form.credentialRef} onChange={set('credentialRef')}>
                <option value="">{engineCreds.length ? '— sin credencial —' : `(no hay credenciales de ${form.engine})`}</option>
                {engineCreds.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.username})</option>)}
              </select>
              <span className="muted small">Se gestionan en <Link to="/credentials">Credenciales</Link>.</span>
            </label>
            <div className="row gap">
              <button type="button" className="btn small" onClick={testForm}
                disabled={!form.dbHost.trim() || !form.credentialRef || formTest?.pending}>Probar conexión</button>
            </div>
            <TestResult result={formTest} />
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

      {scriptsFor && <ScriptsModal instance={scriptsFor} onClose={() => setScriptsFor(null)} />}
      {linkFor && <LinkBucketsModal instance={linkFor} allBuckets={buckets} onClose={() => setLinkFor(null)} />}
    </div>
  );
}
