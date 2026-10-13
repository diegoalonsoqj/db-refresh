import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import Modal from '../../components/Modal.jsx';
import { IconPlug } from '../../components/icons.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import BucketsLinkPanel from './BucketsLinkPanel.jsx';
import ScriptsPanel from './ScriptsPanel.jsx';
import { DEFAULT_PORTS, ENGINES, isMongo } from '../../lib/engines.js';
import { optionsToText, parseConnectionString } from '../../lib/mongoConn.js';

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
  mongoSrv: Boolean(i.mongo_srv), connOptions: optionsToText(i.conn_options),
} : {
  projectRef: projects[0]?.id ?? '', instanceName: '', engine: 'postgres', dbHost: '', dbPort: '', credentialRef: '', isActive: true,
  mongoSrv: false, connOptions: '',
});

/**
 * Formulario de una instancia con pestañas: Datos (proyecto, motor, conexión SQL),
 * Buckets vinculados y Scripts pre/post. Buckets y Scripts necesitan la instancia
 * guardada: al crear una, el modal sigue abierto y pasa a Buckets.
 */
export default function InstanceModal({ instance: initial, projects, buckets, credentials, onClose, onSaved }) {
  const toast = useToast();
  const { has } = useAuth();
  const canWrite = has('catalog:write');
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
  const mongo = isMongo(form.engine);
  // MongoDB: completar host/SRV/puerto/opciones pegando la cadena de conexión (la contraseña se ignora).
  const [connString, setConnString] = useState('');
  const [connHint, setConnHint] = useState(null);
  const applyConnString = () => {
    try {
      const p = parseConnectionString(connString);
      setFormTest(null);
      setForm((f) => ({ ...f, mongoSrv: p.srv, dbHost: p.host, dbPort: p.port, connOptions: p.options }));
      setConnString('');
      setConnHint({ ok: true, text: p.username
        ? `Datos completados. Usa una credencial con el usuario ${p.username} (la contraseña no se guarda en la instancia).`
        : 'Datos completados. Elige la credencial con el usuario y la contraseña.' });
    } catch (err) { setConnHint({ ok: false, text: err.message }); }
  };
  // Campos de conexión que solo usa MongoDB (los demás motores los ignoran).
  const mongoFields = mongo ? { mongoSrv: form.mongoSrv, connOptions: form.connOptions } : { mongoSrv: false, connOptions: {} };
  const portOf = () => (form.dbPort === '' || (mongo && form.mongoSrv) ? null : Number(form.dbPort));

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setFormErr(null);
    const body = { ...form, ...mongoFields, dbPort: portOf(), credentialRef: form.credentialRef || null };
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
        toast.success(isMongo(created.engine) ? 'Instancia creada: vincula sus buckets'
          : 'Instancia creada: vincula sus buckets y, si hace falta, sus scripts pre/post');
        onSaved();
      }
    } catch (err) { setFormErr(err.message); }
    finally { setBusy(false); }
  };

  // Prueba la credencial elegida contra el host del formulario (sin guardar).
  const testForm = async () => {
    setFormTest({ pending: true });
    try {
      setFormTest(await api.post(`/credentials/${form.credentialRef}/test`, { host: form.dbHost, port: portOf(), ...mongoFields }));
    } catch (err) { setFormTest({ ok: false, error: err.message }); }
  };

  // Pestañas visibles: Scripts solo con scripts:read y en motores SQL (MongoDB no tiene
  // scripts pre/post). Sin catalog:write, Datos es de solo lectura.
  const tabs = TABS.filter((t) => t.key !== 'scripts' || (has('scripts:read') && !isMongo(instance?.engine ?? form.engine)));

  const footer = tab === 'data' && canWrite ? (
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
        {tabs.map((t) => (
          <button key={t.key} type="button" className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}
            disabled={t.key !== 'data' && !instance}
            title={t.key !== 'data' && !instance ? 'Guarda antes los datos de la instancia' : undefined}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'data' && (
        <form id={formId} className="form-grid" onSubmit={save}>
          <fieldset className="form-fieldset full" disabled={!canWrite}>
          <label>Proyecto
            <select value={form.projectRef} onChange={set('projectRef')} required>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.project_id}</option>)}
            </select>
          </label>
          <label>Motor
            <select value={form.engine} onChange={setEngine}>
              {ENGINES.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
            </select>
          </label>
          <label className="full">{mongo ? 'Nombre (identificador del servidor o cluster en la app)' : 'Nombre de instancia'}
            <input className="mono" value={form.instanceName} onChange={set('instanceName')} autoFocus required />
          </label>
          {mongo ? (
            <>
              <div className="form-section full">
                <strong>Conexión — obligatoria.</strong> MongoDB (Community o Atlas) no es Cloud SQL: el restore se
                hace con mongorestore desde el servidor de la app, con esta conexión y la credencial. El usuario
                necesita poder borrar y escribir las BD destino (p.ej. readWriteAnyDatabase).
              </div>
              <label className="full">Cadena de conexión (opcional, para completar los campos)
                <div className="row gap">
                  <input className="mono grow" value={connString} onChange={(e) => { setConnString(e.target.value); setConnHint(null); }}
                    placeholder="mongodb+srv://usuario@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority" />
                  <button type="button" className="btn" onClick={applyConnString} disabled={!connString.trim()}>Completar</button>
                </div>
                {connHint && <span className={`field-hint${connHint.ok ? '' : ' warn-text'}`}>{connHint.text}</span>}
              </label>
              <label className="checkline full">
                <input type="checkbox" checked={form.mongoSrv}
                  onChange={(e) => { setFormTest(null); setForm((f) => ({ ...f, mongoSrv: e.target.checked })); }} />
                Atlas / SRV (mongodb+srv://, con TLS)
              </label>
              <label className={form.mongoSrv ? 'full' : undefined}>{form.mongoSrv ? 'Host del cluster (SRV)' : 'Host'}
                <input className="mono" value={form.dbHost} onChange={set('dbHost')} required
                  placeholder={form.mongoSrv ? 'cluster0.xxxxx.mongodb.net' : '10.x.x.x o h1:27017,h2:27017'} />
              </label>
              {!form.mongoSrv && (
                <label>Puerto<input type="number" value={form.dbPort} onChange={set('dbPort')} placeholder={String(DEFAULT_PORTS.mongodb)} /></label>
              )}
              <label className="full">Opciones de conexión
                <input className="mono" value={form.connOptions} onChange={set('connOptions')} placeholder="replicaSet=rs0&tls=true" />
                <span className="field-hint">
                  Formato a=1&amp;b=2. Admitidas: authSource (por defecto admin), replicaSet, readPreference, appName,
                  retryWrites, w, tls, directConnection.
                </span>
              </label>
            </>
          ) : (
            <>
              <div className="form-section full">
                <strong>Conexión SQL — solo para scripts pre/post (opcional).</strong> El restore (drop + import del
                backup) usa el Cloud SQL Admin API con la service account de Ajustes y no la necesita. Indica la IP
                privada y la credencial; sin credencial la instancia no ejecuta scripts pre/post.
              </div>
              <label>Host (IP privada)<input className="mono" value={form.dbHost} onChange={set('dbHost')} placeholder="10.x.x.x" /></label>
              <label>Puerto<input type="number" value={form.dbPort} onChange={set('dbPort')} placeholder={String(DEFAULT_PORTS[form.engine])} /></label>
            </>
          )}
          <label className="full">Credencial
            <select value={form.credentialRef} onChange={set('credentialRef')} required={mongo}>
              <option value="">{engineCreds.length ? (mongo ? '— elegir —' : '— sin credencial —') : `(no hay credenciales de ${form.engine})`}</option>
              {engineCreds.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.username})</option>)}
                {/* Sin permiso para ver credenciales, la actual se muestra por su nombre. */}
                {form.credentialRef && !engineCreds.some((c) => c.id === form.credentialRef) && (
                  <option value={form.credentialRef}>{initial?.credential_name ?? 'credencial asignada'}</option>
                )}
            </select>
            <span className="field-hint">Se gestionan en <Link to="/credentials">Credenciales</Link>.</span>
          </label>
          {formTest && <div className="full"><TestResult result={formTest} /></div>}
          <label className="checkline full">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
            Activo
          </label>
          </fieldset>
          {formErr && <div className="alert error full">{formErr}</div>}
          {!instance && (
            <div className="muted small full">
              {mongo ? 'Al guardar podrás vincular sus buckets en la otra pestaña.'
                : 'Al guardar podrás vincular sus buckets y definir sus scripts pre/post en las otras pestañas.'}
            </div>
          )}
        </form>
      )}
      {tab === 'buckets' && instance && <BucketsLinkPanel instance={instance} allBuckets={buckets} />}
      {tab === 'scripts' && instance && <ScriptsPanel instance={instance} />}
    </Modal>
  );
}
