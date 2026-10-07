import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import Modal from '../../components/Modal.jsx';
import { IconPlug } from '../../components/icons.jsx';
import { useToast } from '../../components/Toast.jsx';
import BucketsLinkPanel from './BucketsLinkPanel.jsx';
import ScriptsPanel from './ScriptsPanel.jsx';

const ENGINES = ['sqlserver', 'postgres', 'mysql'];
const DEFAULT_PORTS = { sqlserver: 1433, postgres: 5432, mysql: 3306 };

const TABS = [
  { key: 'data', label: 'Datos' },
  { key: 'buckets', label: 'Buckets' },
  { key: 'scripts', label: 'Scripts pre/post' },
];

// Resultado de "Probar conexión": { ok, message|error }.
export function TestResult({ result }) {
  if (!result) return null;
  if (result.pending) return <div className="muted small">Probando conexión…</div>;
  return <div className={`alert small ${result.ok ? 'success' : 'error'}`}>{result.ok ? result.message : result.error}</div>;
}

const formOf = (i, projects) => (i?.id ? {
  projectRef: i.project_ref, instanceName: i.instance_name, engine: i.engine, dbHost: i.db_host ?? '',
  dbPort: i.db_port ?? '', credentialRef: i.credential_ref ?? '', isActive: i.is_active,
} : {
  projectRef: projects[0]?.id ?? '', instanceName: '', engine: 'postgres', dbHost: '', dbPort: '', credentialRef: '', isActive: true,
});

/**
 * Formulario de una instancia con pestañas: Datos (proyecto, motor, conexión SQL),
 * Buckets vinculados y Scripts pre/post. Buckets y Scripts necesitan la instancia
 * guardada: al crear una, el modal sigue abierto y pasa a Buckets.
 */
export default function InstanceModal({ instance: initial, projects, buckets, credentials, onClose, onSaved }) {
  const toast = useToast();
  const formId = useId();
  const [instance, setInstance] = useState(initial?.id ? initial : null);
  const [tab, setTab] = useState('data');
  const [form, setForm] = useState(() => formOf(initial, projects));
  const [formErr, setFormErr] = useState(null);
  const [formTest, setFormTest] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => { setFormTest(null); setForm((f) => ({ ...f, [k]: e.target.value })); };
  // Cambiar de motor invalida la credencial elegida (las credenciales son por motor).
  const setEngine = (e) => { setFormTest(null); setForm((f) => ({ ...f, engine: e.target.value, credentialRef: '' })); };
  const engineCreds = (credentials ?? []).filter((c) => c.engine === form.engine);

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setFormErr(null);
    const body = { ...form, dbPort: form.dbPort === '' ? null : Number(form.dbPort), credentialRef: form.credentialRef || null };
    try {
      if (instance) {
        await api.put(`/instances/${instance.id}`, body);
        toast.success('Guardado');
        onSaved();
        onClose();
      } else {
        const created = await api.post('/instances', body);
        setInstance(created);
        setTab('buckets');
        toast.success('Instancia creada: vincula sus buckets y, si hace falta, sus scripts pre/post');
        onSaved();
      }
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

  const footer = tab === 'data' ? (
    <>
      <div className="modal-foot-start">
        <button type="button" className="btn" onClick={testForm}
          disabled={!form.dbHost.trim() || !form.credentialRef || formTest?.pending}><IconPlug /> Probar conexión</button>
      </div>
      <button type="button" className="btn" onClick={onClose}>Cancelar</button>
      <button type="submit" form={formId} className="btn primary" disabled={busy}>Guardar</button>
    </>
  ) : (
    <button type="button" className="btn" onClick={onClose}>Cerrar</button>
  );

  return (
    <Modal size="lg" title={instance ? `Instancia ${instance.instance_name}` : 'Nueva instancia'} onClose={onClose} footer={footer}>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}
            disabled={t.key !== 'data' && !instance}
            title={t.key !== 'data' && !instance ? 'Guarda antes los datos de la instancia' : undefined}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'data' && (
        <form id={formId} className="form-grid" onSubmit={save}>
          <label>Proyecto
            <select value={form.projectRef} onChange={set('projectRef')} required>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.project_id}</option>)}
            </select>
          </label>
          <label>Motor
            <select value={form.engine} onChange={setEngine}>
              {ENGINES.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </label>
          <label className="full">Nombre de instancia<input className="mono" value={form.instanceName} onChange={set('instanceName')} autoFocus required /></label>
          <div className="form-section full">
            <strong>Conexión SQL — solo para scripts pre/post (opcional).</strong> El restore (drop + import del
            backup) usa el Cloud SQL Admin API con la service account de Ajustes y no la necesita. Indica la IP
            privada y la credencial; sin credencial la instancia no ejecuta scripts pre/post.
          </div>
          <label>Host (IP privada)<input className="mono" value={form.dbHost} onChange={set('dbHost')} placeholder="10.x.x.x" /></label>
          <label>Puerto<input type="number" value={form.dbPort} onChange={set('dbPort')} placeholder={String(DEFAULT_PORTS[form.engine])} /></label>
          <label className="full">Credencial
            <select value={form.credentialRef} onChange={set('credentialRef')}>
              <option value="">{engineCreds.length ? '— sin credencial —' : `(no hay credenciales de ${form.engine})`}</option>
              {engineCreds.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.username})</option>)}
            </select>
            <span className="field-hint">Se gestionan en <Link to="/credentials">Credenciales</Link>.</span>
          </label>
          {formTest && <div className="full"><TestResult result={formTest} /></div>}
          <label className="checkline full">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
            Activo
          </label>
          {formErr && <div className="alert error full">{formErr}</div>}
          {!instance && (
            <div className="muted small full">Al guardar podrás vincular sus buckets y definir sus scripts pre/post en las otras pestañas.</div>
          )}
        </form>
      )}
      {tab === 'buckets' && instance && <BucketsLinkPanel instance={instance} allBuckets={buckets} />}
      {tab === 'scripts' && instance && <ScriptsPanel instance={instance} />}
    </Modal>
  );
}
