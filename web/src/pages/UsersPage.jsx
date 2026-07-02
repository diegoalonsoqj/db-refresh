import { useState } from 'react';
import { api } from '../api/client.js';
import { useList } from '../hooks/useList.js';
import { useAuth } from '../auth/AuthContext.jsx';
import Modal from '../components/Modal.jsx';

const ROLES = ['admin', 'operator', 'viewer'];
const empty = { email: '', fullName: '', role: 'viewer', password: '' };

export default function UsersPage() {
  const { user: me } = useAuth();
  const { data: users, error, reload } = useList('/users');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(empty);
  const [formErr, setFormErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = async (e) => {
    e.preventDefault(); setBusy(true); setFormErr(null);
    try { await api.post('/users', form); setCreating(false); setForm(empty); await reload(); }
    catch (err) { setFormErr(err.message); }
    finally { setBusy(false); }
  };

  const patch = async (u, body) => {
    try { await api.patch(`/users/${u.id}`, body); await reload(); }
    catch (err) { alert(err.message); }
  };

  const resetPwd = async (u) => {
    const password = prompt(`Nuevo password para ${u.email} (mín. 10):`);
    if (!password) return;
    try { await api.post(`/users/${u.id}/reset-password`, { password }); alert('Password actualizado'); }
    catch (err) { alert(err.message); }
  };

  const remove = async (u) => {
    if (!confirm(`¿Eliminar a ${u.email}?`)) return;
    try { await api.del(`/users/${u.id}`); await reload(); }
    catch (err) { alert(err.message); }
  };

  if (error) return <div className="alert error">{error}</div>;
  if (!users) return <div className="muted">Cargando…</div>;

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ margin: 0 }}>Usuarios</h2>
        <button className="btn primary small" onClick={() => { setForm(empty); setCreating(true); setFormErr(null); }}>+ Nuevo usuario</button>
      </div>
      <table className="table">
        <thead><tr><th>Email</th><th>Nombre</th><th>Rol</th><th>Fuente</th><th>Activo</th><th /></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td className="mono small">{u.email}{u.id === me.id && <span className="pill" style={{ marginLeft: 6 }}>tú</span>}</td>
              <td>{u.full_name}</td>
              <td>
                <select value={u.role} onChange={(e) => patch(u, { role: e.target.value })}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </td>
              <td>{u.auth_source}</td>
              <td>
                <button className={`pill ${u.is_active ? 'on' : ''}`} style={{ cursor: 'pointer', border: 'none' }}
                  onClick={() => patch(u, { isActive: !u.is_active })}>
                  {u.is_active ? 'sí' : 'no'}
                </button>
              </td>
              <td className="actions">
                {u.auth_source === 'local' && <button className="btn ghost small" onClick={() => resetPwd(u)}>Reset pwd</button>}
                <button className="btn ghost small" onClick={() => remove(u)} disabled={u.id === me.id}>Eliminar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {creating && (
        <Modal title="Nuevo usuario" onClose={() => setCreating(false)}>
          <form className="stack" onSubmit={create}>
            <label>Email<input type="email" value={form.email} onChange={set('email')} autoFocus required /></label>
            <label>Nombre<input value={form.fullName} onChange={set('fullName')} /></label>
            <label>Rol
              <select value={form.role} onChange={set('role')}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label>Password (mín. 10)<input type="password" value={form.password} onChange={set('password')} required /></label>
            {formErr && <div className="alert error">{formErr}</div>}
            <div className="row gap">
              <button className="btn primary" disabled={busy}>Crear</button>
              <button type="button" className="btn" onClick={() => setCreating(false)}>Cancelar</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
