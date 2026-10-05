import { useState } from 'react';
import { api } from '../api/client.js';
import { useList } from '../hooks/useList.js';
import Modal from '../components/Modal.jsx';

// Credenciales SQL reutilizables: las usan las instancias (IP privada + credencial)
// para ejecutar scripts pre/post. La contraseña nunca vuelve del servidor.
const ENGINES = [
  { key: 'sqlserver', label: 'SQL Server' },
  { key: 'postgres', label: 'PostgreSQL' },
  { key: 'mysql', label: 'MySQL' },
];
const engineLabel = (k) => ENGINES.find((e) => e.key === k)?.label ?? k;
const empty = { name: '', engine: 'sqlserver', username: '', secretKind: 'stored', password: '', secretRef: '', description: '' };

export default function CredentialsPage() {
  const { data: creds, error, reload } = useList('/credentials');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [formErr, setFormErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const openNew = () => { setForm(empty); setEditing({}); setFormErr(null); };
  const openEdit = (c) => {
    setForm({
      name: c.name, engine: c.engine, username: c.username, secretKind: c.secret_kind,
      password: '', secretRef: c.secret_ref ?? '', description: c.description ?? '',
    });
    setEditing(c); setFormErr(null);
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setFormErr(null);
    const body = { ...form };
    if (body.secretKind === 'stored') delete body.secretRef; else delete body.password;
    try {
      if (editing.id) await api.put(`/credentials/${editing.id}`, body);
      else await api.post('/credentials', body);
      setEditing(null); await reload();
    } catch (err) { setFormErr(err.message); }
    finally { setBusy(false); }
  };

  const remove = async (c) => {
    if (!confirm(`¿Eliminar la credencial "${c.name}"?`)) return;
    try { await api.del(`/credentials/${c.id}`); await reload(); }
    catch (err) { alert(err.message); }
  };

  // Al editar una credencial guardada, la contraseña es opcional (vacía = sin cambios).
  const keepsPassword = editing?.id && editing.secret_kind === 'stored' && editing.has_password;

  return (
    <div>
      <h2>Credenciales SQL</h2>
      <p className="muted small">
        Usuario y contraseña con los que la app se conecta a las instancias (por IP privada) para ejecutar
        scripts pre/post. Una credencial puede usarse en varias instancias del mismo motor. Las contraseñas se
        guardan cifradas y nunca se muestran.
      </p>
      {error && <div className="alert error">{error}</div>}
      {!creds ? <div className="muted">Cargando…</div> : (
        <>
          <div className="toolbar">
            <span className="muted small">{creds.length} credencial(es)</span>
            <button className="btn primary small" onClick={openNew}>Nueva credencial</button>
          </div>
          <table className="table">
            <thead>
              <tr><th>Nombre</th><th>Motor</th><th>Usuario</th><th>Contraseña</th><th>Instancias</th><th /></tr>
            </thead>
            <tbody>
              {creds.length === 0 && <tr><td colSpan="6" className="muted">Sin credenciales.</td></tr>}
              {creds.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div>{c.name}</div>
                    {c.description && <div className="muted small">{c.description}</div>}
                  </td>
                  <td>{engineLabel(c.engine)}</td>
                  <td className="mono small">{c.username}</td>
                  <td className="small">
                    {c.secret_kind === 'stored'
                      ? <span className="pill on">Cifrada en la app</span>
                      : <span className="mono muted" title="Referencia a Secret Manager / variable de entorno">{c.secret_ref}</span>}
                  </td>
                  <td>{c.instance_count}</td>
                  <td className="actions">
                    <button className="btn ghost small" onClick={() => openEdit(c)}>Editar</button>
                    <button className="btn ghost small" onClick={() => remove(c)} disabled={c.instance_count > 0}
                      title={c.instance_count > 0 ? 'En uso por instancias' : undefined}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {editing && (
        <Modal title={editing.id ? 'Editar credencial' : 'Nueva credencial'} onClose={() => setEditing(null)}>
          <form className="stack" onSubmit={save} autoComplete="off">
            <label>Nombre<input value={form.name} onChange={set('name')} placeholder="p.ej. sqlserver-homologacion" autoFocus required /></label>
            <div className="row gap" style={{ alignItems: 'flex-start' }}>
              <label style={{ flex: 1 }}>Motor
                <select value={form.engine} onChange={set('engine')} disabled={editing.instance_count > 0}>
                  {ENGINES.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
                </select>
              </label>
              <label style={{ flex: 1 }}>Usuario<input className="mono" value={form.username} onChange={set('username')} required /></label>
            </div>
            <label>Contraseña
              <select value={form.secretKind} onChange={set('secretKind')}>
                <option value="stored">Guardar cifrada en la app</option>
                <option value="ref">Referencia a Secret Manager</option>
              </select>
            </label>
            {form.secretKind === 'stored' ? (
              <label>
                {keepsPassword ? 'Nueva contraseña (opcional)' : 'Contraseña'}
                <input type="password" autoComplete="new-password" value={form.password} onChange={set('password')}
                  placeholder={keepsPassword ? 'Dejar vacío para conservar la actual' : ''} required={!keepsPassword} />
              </label>
            ) : (
              <label>Referencia
                <input className="mono" value={form.secretRef} onChange={set('secretRef')} placeholder="sm://projects/<p>/secrets/<s>" required />
                <span className="muted small">
                  <span className="mono">sm://projects/&lt;p&gt;/secrets/&lt;s&gt;[/versions/&lt;v&gt;]</span> (la service account necesita
                  el rol Secret Manager Secret Accessor) o <span className="mono">env:NOMBRE</span>.
                </span>
              </label>
            )}
            <label>Descripción<input value={form.description} onChange={set('description')} placeholder="opcional" /></label>
            {formErr && <div className="alert error">{formErr}</div>}
            <div className="row gap">
              <button className="btn primary" disabled={busy}>Guardar</button>
              <button type="button" className="btn" onClick={() => setEditing(null)}>Cancelar</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
