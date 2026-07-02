import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

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

function AdSection() {
  const [cur, setCur] = useState(null);
  const [form, setForm] = useState({ url: '', baseDn: '', bindDn: '', bindPassword: '' });
  const [msg, setMsg] = useState(null);
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.get('/settings/ad').then((d) => {
      setCur(d);
      setForm({ url: d.url ?? '', baseDn: d.baseDn ?? '', bindDn: d.bindDn ?? '', bindPassword: '' });
    });
  useEffect(() => { load(); }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null); setTest(null);
    try {
      // no enviar bindPassword vacío: el backend conserva el guardado
      const body = { url: form.url, baseDn: form.baseDn, bindDn: form.bindDn };
      if (form.bindPassword) body.bindPassword = form.bindPassword;
      await api.put('/settings/ad', body);
      setMsg({ ok: true, message: 'Guardado' });
      await load();
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
      <div className="row between">
        <h3 style={{ margin: 0 }}>AD / LDAP</h3>
        {cur && <span className="pill">{cur.source ? `fuente: ${cur.source}` : 'sin configurar'}</span>}
      </div>
      <label>URL<input value={form.url} onChange={set('url')} placeholder="ldaps://ad.empresa.local:636" /></label>
      <label>Base DN<input value={form.baseDn} onChange={set('baseDn')} placeholder="DC=empresa,DC=local" /></label>
      <label>Bind DN<input value={form.bindDn} onChange={set('bindDn')} placeholder="CN=svc,OU=...,DC=..." /></label>
      <label>
        Bind password
        <input
          type="password"
          value={form.bindPassword}
          onChange={set('bindPassword')}
          placeholder={cur?.hasBindPassword ? '•••••• (guardado; deja vacío para conservar)' : ''}
        />
      </label>
      <div className="row gap">
        <button className="btn primary" disabled={busy}>Guardar</button>
        <button type="button" className="btn" onClick={doTest} disabled={busy}>Probar conexión</button>
      </div>
      <ResultLine result={msg} />
      <ResultLine result={test} />
    </form>
  );
}

function GcpSection() {
  const [cur, setCur] = useState(null);
  const [json, setJson] = useState('');
  const [msg, setMsg] = useState(null);
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/settings/gcp').then(setCur);
  useEffect(() => { load(); }, []);

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
      await load();
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
      <div className="row between">
        <h3 style={{ margin: 0 }}>GCP Service Account</h3>
        {cur && <span className={`pill ${cur.configured ? 'on' : ''}`}>{cur.configured ? 'configurada' : 'sin configurar'}</span>}
      </div>
      {cur?.configured && (
        <div className="muted small mono">{cur.clientEmail} · {cur.projectId}</div>
      )}
      <label>
        Subir JSON de la SA
        <input type="file" accept="application/json,.json" onChange={onFile} />
      </label>
      <label>
        …o pegar el contenido
        <textarea className="textarea" value={json} onChange={(e) => setJson(e.target.value)} placeholder='{ "type": "service_account", ... }' />
      </label>
      <div className="row gap">
        <button className="btn primary" disabled={busy || !json.trim()}>Guardar</button>
        <button type="button" className="btn" onClick={doTest} disabled={busy}>Probar credenciales</button>
      </div>
      <ResultLine result={msg} />
      <ResultLine result={test} />
    </form>
  );
}

export default function SettingsPage() {
  return (
    <div>
      <h2>Ajustes</h2>
      <div className="stack" style={{ maxWidth: 560 }}>
        <AdSection />
        <GcpSection />
      </div>
    </div>
  );
}
