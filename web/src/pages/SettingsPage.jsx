import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { THEMES, useTheme } from '../theme/ThemeContext.jsx';

function ResultLine({ result }) {
  if (!result) return null;
  return (
    <div className={`alert ${result.ok ? 'success' : 'error'} result`}>
      {result.message || result.error || (result.ok ? 'Prueba correcta' : 'La prueba falló')}
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

const AD_MODES = [
  { id: 'direct', label: 'Bind directo (DOMINIO\\usuario)' },
  { id: 'search', label: 'Cuenta de servicio + búsqueda' },
];
const AD_SECURITY = [
  { id: 'starttls', label: 'StartTLS (ldap://, puerto 389) — recomendado' },
  { id: 'ldaps', label: 'LDAPS (ldaps://, puerto 636)' },
  { id: 'none', label: 'Sin cifrar (ldap://)' },
];
const AD_EMPTY = {
  enabled: false, mode: 'direct', security: 'starttls', url: '', domain: '', bindDn: '', bindPassword: '',
  searchBase: '', userFilter: '(sAMAccountName={{username}})', tlsRejectUnauthorized: true,
};

function AdSection({ data, onReload }) {
  const [form, setForm] = useState(AD_EMPTY);
  const [msg, setMsg] = useState(null);
  const [test, setTest] = useState(null);
  const [testUser, setTestUser] = useState('');
  const [testPass, setTestPass] = useState('');
  const [busy, setBusy] = useState(false);

  // El formulario arranca desde lo guardado; la password de bind nunca vuelve del backend.
  useEffect(() => {
    if (!data) return;
    setForm({
      enabled: Boolean(data.enabled),
      mode: data.mode ?? 'direct',
      security: data.security ?? 'starttls',
      url: data.url ?? '',
      domain: data.domain ?? '',
      bindDn: data.bindDn ?? '',
      bindPassword: '',
      searchBase: data.searchBase ?? '',
      userFilter: data.userFilter ?? AD_EMPTY.userFilter,
      tlsRejectUnauthorized: data.tlsRejectUnauthorized ?? true,
    });
  }, [data]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const check = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.checked }));
  const isDirect = form.mode === 'direct';

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null); setTest(null);
    try {
      // no enviar bindPassword vacío: el backend conserva la guardada
      const { bindPassword, ...body } = form;
      if (bindPassword) body.bindPassword = bindPassword;
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
      setTest(await api.post('/settings/ad/test', { username: testUser.trim(), password: testPass }));
    } catch (err) {
      setTest({ ok: false, error: err.message });
    } finally {
      setTestPass('');
      setBusy(false);
    }
  };

  const configured = Boolean(data?.enabled && data?.url);

  return (
    <div className="stack">
      <form className="card stack" onSubmit={save}>
        <SectionHead
          title="AD / LDAP"
          description="Permite que los usuarios de AD dados de alta en Usuarios inicien sesión con su cuenta de red. Lo guardado aquí tiene prioridad sobre las variables AD_* del .env."
          pill={<span className={`pill ${configured ? 'on' : ''}`}>{configured ? 'habilitado' : 'deshabilitado'}</span>}
        />

        <label className="checkline">
          <input type="checkbox" checked={form.enabled} onChange={check('enabled')} />
          Habilitar autenticación AD
        </label>

        <Field label="Modo de autenticación" hint={isDirect
          ? 'Cada usuario hace bind con su propia cuenta; no hace falta cuenta de servicio.'
          : 'Una cuenta de servicio busca al usuario y luego se valida su contraseña.'}>
          <select value={form.mode} onChange={set('mode')}>
            {AD_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </Field>

        <Field label="Cifrado de la conexión">
          <select value={form.security} onChange={set('security')}>
            {AD_SECURITY.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </Field>
        {form.security === 'none' && (
          <div className="alert error small">
            Sin cifrar, la contraseña de cada inicio de sesión viaja en texto plano por la red. Úsalo solo si el
            controlador de dominio no admite StartTLS ni LDAPS.
          </div>
        )}

        <Field label="URL del servidor">
          <input className="mono" value={form.url} onChange={set('url')}
            placeholder={form.security === 'ldaps' ? 'ldaps://dc.empresa.local:636' : 'ldap://dc.empresa.local'} />
        </Field>

        {isDirect ? (
          <>
            <Field label="Dominio" hint="NetBIOS (EMPRESA → EMPRESA\usuario) o DNS (empresa.com → usuario@empresa.com).">
              <input value={form.domain} onChange={set('domain')} placeholder="EMPRESA" />
            </Field>
            <Field label="Base de búsqueda" hint="Opcional: si la indicas, se leen el nombre y el correo del usuario al iniciar sesión.">
              <input className="mono" value={form.searchBase} onChange={set('searchBase')} placeholder="DC=empresa,DC=local" />
            </Field>
          </>
        ) : (
          <>
            <Field label="Bind DN (cuenta de servicio)">
              <input className="mono" value={form.bindDn} onChange={set('bindDn')} placeholder="CN=svc,OU=...,DC=..." />
            </Field>
            <Field
              label="Contraseña de bind"
              hint={data?.hasBindPassword ? 'Ya hay una guardada (cifrada). Déjala vacía para conservarla.' : 'Se guarda cifrada (AES-256-GCM).'}
            >
              <input type="password" value={form.bindPassword} onChange={set('bindPassword')}
                autoComplete="new-password" placeholder={data?.hasBindPassword ? '•••••• (guardada)' : ''} />
            </Field>
            <Field label="Base de búsqueda">
              <input className="mono" value={form.searchBase} onChange={set('searchBase')} placeholder="DC=empresa,DC=local" />
            </Field>
          </>
        )}

        <Field label="Filtro de usuario" hint="{{username}} se reemplaza por la cuenta (escapada).">
          <input className="mono" value={form.userFilter} onChange={set('userFilter')} />
        </Field>

        {form.security !== 'none' && (
          <label className="checkline">
            <input type="checkbox" checked={form.tlsRejectUnauthorized} onChange={check('tlsRejectUnauthorized')} />
            Validar certificado TLS
          </label>
        )}

        <div className="row gap">
          <button className="btn primary" disabled={busy}>Guardar</button>
        </div>
        <ResultLine result={msg} />

        <dl className="meta-grid">
          <div><dt>Origen</dt><dd>{data?.source === 'env' ? '.env (fallback)' : data?.source ?? 'sin definir'}</dd></div>
          <div><dt>Última actualización</dt><dd>{fmtDate(data?.updatedAt)}</dd></div>
        </dl>
      </form>

      <div className="card stack">
        <SectionHead
          title="Probar AD"
          description="Valida un usuario y contraseña con la configuración GUARDADA. La contraseña no se guarda."
        />
        <div className="row gap">
          <Field label="Usuario de AD">
            <input value={testUser} autoComplete="off" onChange={(e) => setTestUser(e.target.value)} placeholder="DOMINIO\usuario" />
          </Field>
          <Field label="Contraseña">
            <input type="password" value={testPass} autoComplete="new-password" onChange={(e) => setTestPass(e.target.value)} />
          </Field>
        </div>
        <div className="row gap">
          <button type="button" className="btn" onClick={doTest} disabled={busy || !testUser.trim() || !testPass}>
            {busy ? 'Probando…' : 'Probar'}
          </button>
        </div>
        <ResultLine result={test} />
        {test?.ok && (test.fullName || test.email) && (
          <div className="small muted">{test.fullName} {test.email && <span className="mono">· {test.email}</span>}</div>
        )}
      </div>
    </div>
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

const MODE_OPTIONS = [
  { id: 'dark', label: 'Oscuro' },
  { id: 'light', label: 'Claro' },
  { id: 'system', label: 'Sistema' },
];

/** Paleta + modo. Preferencia personal: se guarda para el usuario en este navegador. */
function AppearanceSection() {
  const { theme, mode, isDark, setTheme, setMode } = useTheme();

  return (
    <div className="card stack">
      <SectionHead
        title="Apariencia"
        description="Paleta de colores y modo claro u oscuro. Es una preferencia personal: se guarda para tu usuario en este navegador."
      />

      <div className="field">
        <span className="field-label">Paleta</span>
        <div className="theme-grid">
          {THEMES.map((t) => {
            const [bg, card, accent] = t.swatch[isDark ? 'dark' : 'light'];
            const active = t.id === theme;
            return (
              <button
                key={t.id}
                type="button"
                className={`theme-card ${active ? 'active' : ''}`}
                onClick={() => setTheme(t.id)}
                aria-pressed={active}
              >
                {/* Mini vista previa: fondo, sidebar/tarjeta y primario en el modo actual */}
                <span className="theme-preview" style={{ background: bg }}>
                  <span className="theme-preview-side" style={{ background: card }} />
                  <span className="theme-preview-card" style={{ background: card }}>
                    <span style={{ background: accent, width: '65%' }} />
                    <span style={{ background: accent, width: '35%', opacity: 0.4 }} />
                  </span>
                </span>
                <span className="theme-name">{t.label}</span>
                <span className="field-hint">{t.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Modo</span>
        <div className="segmented" role="group" aria-label="Modo">
          {MODE_OPTIONS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={mode === m.id ? 'active' : ''}
              onClick={() => setMode(m.id)}
              aria-pressed={mode === m.id}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="field-hint">«Sistema» sigue la preferencia del sistema operativo.</span>
      </div>
    </div>
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
        <div><dt>Sesión</dt><dd className="mono">{user?.email ?? user?.username}</dd></div>
      </dl>
    </div>
  );
}

const SECTIONS = [
  { id: 'appearance', label: 'Apariencia' },
  { id: 'ad', label: 'AD / LDAP', admin: true },
  { id: 'gcp', label: 'GCP', admin: true },
  { id: 'system', label: 'Sistema', admin: true },
];

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [section, setSection] = useState('appearance');
  const [ad, setAd] = useState(null);
  const [gcp, setGcp] = useState(null);

  // Los estados viven aquí (no en cada sección) para que la nav pueda mostrar
  // de un vistazo qué está configurado y qué no. Solo admin: la API lo exige.
  const loadAd = () => api.get('/settings/ad').then(setAd);
  const loadGcp = () => api.get('/settings/gcp').then(setGcp);
  useEffect(() => { if (isAdmin) { loadAd(); loadGcp(); } }, [isAdmin]);

  const status = { ad: Boolean(ad?.enabled && ad?.url), gcp: Boolean(gcp?.configured) };
  const sections = SECTIONS.filter((s) => isAdmin || !s.admin);

  return (
    <div>
      <div className="settings-layout">
        <nav className="settings-nav">
          {sections.map((s) => (
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
          {section === 'appearance' && <AppearanceSection />}
          {isAdmin && section === 'ad' && <AdSection data={ad} onReload={loadAd} />}
          {isAdmin && section === 'gcp' && <GcpSection data={gcp} onReload={loadGcp} />}
          {isAdmin && section === 'system' && <SystemSection />}
        </div>
      </div>
    </div>
  );
}
