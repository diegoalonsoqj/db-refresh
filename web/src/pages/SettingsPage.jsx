import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';

function ResultLine({ result }) {
  if (!result) return null;
  return (
    <div className={`alert ${result.ok ? 'warn' : 'error'} result`}>
      {result.ok ? '✅ ' : '❌ '}
      {result.message || result.error || (result.ok ? 'OK' : 'Falló')}
      {result.clientEmail && <div className="small mono">{result.clientEmail}</div>}
    </div>
  );
}

/** Campo con etiqueta y pista debajo (mismo patrón que db-keeper / db-profiler). */
function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function SectionHead({ title, description, pill }) {
  return (
    <div className="section-head">
      <div>
        <h3>{title}</h3>
        {description && <p className="muted small">{description}</p>}
      </div>
      {pill}
    </div>
  );
}

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleString() : '—';
}

function AdSection({ data, onReload }) {
  const [form, setForm] = useState({ url: '', baseDn: '', bindDn: '', bindPassword: '' });
  const [msg, setMsg] = useState(null);
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState(false);

  // El formulario arranca desde lo guardado; la password nunca vuelve del backend.
  useEffect(() => {
    if (!data) return;
    setForm({
      url: data.url ?? '',
      baseDn: data.baseDn ?? '',
      bindDn: data.bindDn ?? '',
      bindPassword: '',
    });
  }, [data]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null); setTest(null);
    try {
      // no enviar bindPassword vacío: el backend conserva la guardada
      const body = { url: form.url, baseDn: form.baseDn, bindDn: form.bindDn };
      if (form.bindPassword) body.bindPassword = form.bindPassword;
      await api.put('/settings/ad', body);
      setMsg({ ok: true, message: 'Guardado' });
      await onReload();
    } catch (err) {
      setMsg({ ok: false, error: err.message });
    } finally { setBusy(false); }
  };

  const doTest = async () => {
    setBusy(true); setTest(null); setMsg(null);
    try {
      const body = { url: form.url, bindDn: form.bindDn };
      if (form.bindPassword) body.bindPassword = form.bindPassword;
      setTest(await api.post('/settings/ad/test', body));
    } catch (err) {
      setTest({ ok: false, error: err.message });
    } finally { setBusy(false); }
  };

  return (
    <form className="card stack" onSubmit={save}>
      <SectionHead
        title="AD / LDAP"
        description="Permite iniciar sesión con las credenciales del directorio. Sin esto, el login solo ofrece cuentas locales."
        pill={<span className={`pill ${data?.url ? 'on' : ''}`}>{data?.url ? 'configurado' : 'sin configurar'}</span>}
      />

      <Field label="URL" hint="Usa ldaps:// (636) siempre que el directorio lo soporte.">
        <input value={form.url} onChange={set('url')} placeholder="ldaps://ad.empresa.local:636" />
      </Field>
      <Field label="Base DN" hint="Rama bajo la que se buscan los usuarios.">
        <input value={form.baseDn} onChange={set('baseDn')} placeholder="DC=empresa,DC=local" />
      </Field>
      <Field label="Bind DN" hint="Cuenta de servicio con permiso de lectura para buscar usuarios.">
        <input value={form.bindDn} onChange={set('bindDn')} placeholder="CN=svc,OU=...,DC=..." />
      </Field>
      <Field
        label="Bind password"
        hint={data?.hasBindPassword ? 'Ya hay una guardada (cifrada). Déjalo vacío para conservarla.' : 'Se guarda cifrada (AES-256-GCM).'}
      >
        <input
          type="password"
          value={form.bindPassword}
          onChange={set('bindPassword')}
          placeholder={data?.hasBindPassword ? '•••••• (guardada)' : ''}
        />
      </Field>

      <div className="row gap">
        <button className="btn primary" disabled={busy}>Guardar</button>
        <button type="button" className="btn" onClick={doTest} disabled={busy}>Probar conexión</button>
      </div>
      <ResultLine result={msg} />
      <ResultLine result={test} />

      <dl className="meta-grid">
        <div><dt>Origen</dt><dd>{data?.source ?? 'sin definir'}</dd></div>
        <div><dt>Última actualización</dt><dd>{fmtDate(data?.updatedAt)}</dd></div>
      </dl>
    </form>
  );
}

function GcpSection({ data, onReload }) {
  const [json, setJson] = useState('');
  const [msg, setMsg] = useState(null);
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState(false);

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setJson(String(reader.result));
    reader.readAsText(file);
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null); setTest(null);
    try {
      await api.put('/settings/gcp', { json });
      setMsg({ ok: true, message: 'Service account guardada' });
      setJson('');
      await onReload();
    } catch (err) {
      setMsg({ ok: false, error: err.details?.missing ? `Faltan campos: ${err.details.missing.join(', ')}` : err.message });
    } finally { setBusy(false); }
  };

  const doTest = async () => {
    setBusy(true); setTest(null); setMsg(null);
    try { setTest(await api.post('/settings/gcp/test')); }
    catch (err) { setTest({ ok: false, error: err.message }); }
    finally { setBusy(false); }
  };

  return (
    <form className="card stack" onSubmit={save}>
      <SectionHead
        title="GCP Service Account"
        description="Credenciales con las que la app habla con Cloud SQL Admin API y Cloud Storage. Sin esto no se pueden listar backups ni restaurar."
        pill={<span className={`pill ${data?.configured ? 'on' : ''}`}>{data?.configured ? 'configurada' : 'sin configurar'}</span>}
      />

      <Field label="Subir JSON de la SA" hint="El archivo no se guarda en disco: se cifra y va a la base de datos.">
        <input type="file" accept="application/json,.json" onChange={onFile} />
      </Field>
      <Field label="…o pegar el contenido" hint="Debe incluir client_email, private_key y project_id.">
        <textarea
          className="textarea"
          value={json}
          onChange={(e) => setJson(e.target.value)}
          placeholder='{ "type": "service_account", ... }'
        />
      </Field>

      <div className="row gap">
        <button className="btn primary" disabled={busy || !json.trim()}>Guardar</button>
        <button type="button" className="btn" onClick={doTest} disabled={busy}>Probar credenciales</button>
      </div>
      <ResultLine result={msg} />
      <ResultLine result={test} />

      <dl className="meta-grid">
        <div><dt>Service account</dt><dd className="mono">{data?.clientEmail ?? '—'}</dd></div>
        <div><dt>Proyecto</dt><dd className="mono">{data?.projectId ?? '—'}</dd></div>
        <div><dt>Origen</dt><dd>{data?.source ?? 'sin definir'}</dd></div>
        <div><dt>Última actualización</dt><dd>{fmtDate(data?.updatedAt)}</dd></div>
      </dl>
    </form>
  );
}

/** Solo lectura: estado de la API y de la BD, versión y sesión actual. */
function SystemSection() {
  const { user } = useAuth();
  const [health, setHealth] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get('/health').then(setHealth).catch((e) => setErr(e.message));
  }, []);

  return (
    <div className="card stack">
      <SectionHead title="Sistema" description="Estado de la aplicación. No hay nada que configurar aquí." />

      {err && <div className="alert error">{err}</div>}

      <div className="row gap">
        <span className="pill on">API</span>
        <span className={`pill ${health?.db ? 'on' : ''}`}>
          BD{health?.dbLatencyMs != null ? ` · ${health.dbLatencyMs} ms` : ''}
        </span>
      </div>

      <dl className="meta-grid">
        <div><dt>Versión</dt><dd>{health?.version ?? '—'}</dd></div>
        <div><dt>Entorno</dt><dd>{health?.env ?? '—'}</dd></div>
        <div>
          <dt>Uptime</dt>
          <dd>{health ? `${Math.floor(health.uptimeSecs / 60)} min` : '—'}</dd>
        </div>
        <div><dt>Sesión</dt><dd className="mono">{user?.email}</dd></div>
      </dl>
    </div>
  );
}

const SECTIONS = [
  { id: 'ad', label: 'AD / LDAP' },
  { id: 'gcp', label: 'GCP' },
  { id: 'system', label: 'Sistema' },
];

export default function SettingsPage() {
  const [section, setSection] = useState('ad');
  const [ad, setAd] = useState(null);
  const [gcp, setGcp] = useState(null);

  // Los estados viven aquí (no en cada sección) para que la nav pueda mostrar
  // de un vistazo qué está configurado y qué no.
  const loadAd = () => api.get('/settings/ad').then(setAd);
  const loadGcp = () => api.get('/settings/gcp').then(setGcp);
  useEffect(() => { loadAd(); loadGcp(); }, []);

  const status = { ad: Boolean(ad?.url), gcp: Boolean(gcp?.configured) };

  return (
    <div>
      <h2>Ajustes</h2>

      <div className="settings-layout">
        <nav className="settings-nav">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={section === s.id ? 'active' : ''}
              onClick={() => setSection(s.id)}
            >
              <span>{s.label}</span>
              {s.id in status && (
                <span
                  className={`dot ${status[s.id] ? 'ok' : ''}`}
                  title={status[s.id] ? 'Configurado' : 'Sin configurar'}
                />
              )}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {section === 'ad' && <AdSection data={ad} onReload={loadAd} />}
          {section === 'gcp' && <GcpSection data={gcp} onReload={loadGcp} />}
          {section === 'system' && <SystemSection />}
        </div>
      </div>
    </div>
  );
}
