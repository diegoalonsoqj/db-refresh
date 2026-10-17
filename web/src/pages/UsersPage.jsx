import { useState } from 'react';
import { api } from '../api/client.js';
import { useList } from '../hooks/useList.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { FormModal, IconButton, NewButton, PageHead } from '../components/ui.jsx';
import { EmptyRow, FilterSelect, ListToolbar, Pagination, SortTh } from '../components/list.jsx';
import { useListParams } from '../hooks/useListParams.js';
import { IconDelete, IconKey } from '../components/icons.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/Toast.jsx';

// Roles base del RBAC (la gestión completa de roles llega con la pantalla de Roles y Permisos).
const ROLES = ['superadmin', 'admin', 'operator', 'viewer'];
const AUTH_OPTIONS = [{ value: 'local', label: 'Local' }, { value: 'ad', label: 'AD' }];
const STATUS_OPTIONS = [{ value: 'true', label: 'Activos' }, { value: 'false', label: 'Inactivos' }];
const empty = { authSource: 'local', email: '', username: '', fullName: '', role: 'viewer', password: '' };

export default function UsersPage() {
  const confirm = useConfirm();
  const toast = useToast();
  const { user: me, has } = useAuth();
  const canWrite = has('users:write');
  const list = useListParams({ filters: ['role', 'authSource', 'active'], defaultSort: { key: 'user', dir: 'asc' } });
  const { data, error, reload } = useList(`/users?${list.apiQuery}`);
  const users = data?.items;
  // Sin permiso para leer roles, el filtro ofrece los de sistema.
  const { data: roleList } = useList(has('roles:read') ? '/roles' : null);
  const roleOptions = roleList
    ? roleList.map((r) => ({ value: r.key, label: r.name }))
    : ROLES.map((r) => ({ value: r, label: r }));
  const { data: ad } = useList('/settings/ad');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(empty);
  const [formErr, setFormErr] = useState(null);
  const [busy, setBusy] = useState(false);
  // Restablecer contraseña de un usuario local: { user, password, error } o null.
  const [pwd, setPwd] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const isAd = form.authSource === 'ad';
  const adReady = Boolean(ad?.enabled && ad?.url);

  const create = async (e) => {
    e.preventDefault(); setBusy(true); setFormErr(null);
    const body = isAd
      ? { authSource: 'ad', username: form.username, email: form.email || undefined, fullName: form.fullName, role: form.role }
      : { authSource: 'local', email: form.email, fullName: form.fullName, role: form.role, password: form.password };
    try { await api.post('/users', body); setCreating(false); setForm(empty); toast.success('Usuario creado'); await reload(); }
    catch (err) { setFormErr(err.message); }
    finally { setBusy(false); }
  };

  const patch = async (u, body) => {
    try { await api.patch(`/users/${u.id}`, body); await reload(); }
    catch (err) { toast.error(err.message); }
  };

  const label = (u) => u.email ?? u.username;

  const resetPwd = async (e) => {
    e.preventDefault();
    if (!pwd.password) return;
    setBusy(true);
    try {
      await api.post(`/users/${pwd.user.id}/reset-password`, { password: pwd.password });
      setPwd(null); toast.success('Password actualizado');
    } catch (err) { setPwd((p) => ({ ...p, error: err.message })); }
    finally { setBusy(false); }
  };

  const remove = async (u) => {
    if (!(await confirm({ message: `¿Eliminar a ${label(u)}?`, confirmLabel: 'Eliminar', danger: true }))) return;
    try { await api.del(`/users/${u.id}`); await reload(); }
    catch (err) { toast.error(err.message); }
  };

  return (
    <div className="page-fill">
      <PageHead info={data ? `${data.total} usuario(s)` : null}>
        {canWrite && <NewButton onClick={() => { setForm(empty); setCreating(true); setFormErr(null); }}>Nuevo usuario</NewButton>}
      </PageHead>
      <ListToolbar
        search={list.q}
        onSearch={(q) => list.update({ q })}
        searchPlaceholder="Usuario, email o nombre"
        hasFilters={list.hasFilters}
        onClear={list.clear}
      >
        <FilterSelect label="Rol" value={list.filters.role} onChange={(role) => list.update({ role })} options={roleOptions} />
        <FilterSelect label="Tipo" value={list.filters.authSource} onChange={(authSource) => list.update({ authSource })} options={AUTH_OPTIONS} />
        <FilterSelect label="Estado" value={list.filters.active} onChange={(active) => list.update({ active })} options={STATUS_OPTIONS} />
      </ListToolbar>
      {error && <div className="alert error">{error}</div>}
      {!users ? <div className="muted">Cargando…</div> : (
      <>
      <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <SortTh sortKey="user" {...list.sortProps}>Usuario</SortTh>
            <SortTh sortKey="name" {...list.sortProps}>Nombre</SortTh>
            <th>Rol</th>
            <SortTh sortKey="authSource" {...list.sortProps}>Tipo</SortTh>
            <SortTh sortKey="status" {...list.sortProps}>Activo</SortTh>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {users.length === 0 && <EmptyRow colSpan={6} filtered={list.hasFilters} />}
          {users.map((u) => (
            <tr key={u.id}>
              <td className="mono small">
                {u.auth_source === 'ad' ? u.username : u.email}
                {u.auth_source === 'ad' && u.email && <div className="muted">{u.email}</div>}
                {u.id === me.id && <span className="pill" style={{ marginLeft: 6 }}>tú</span>}
              </td>
              <td>{u.full_name}</td>
              <td>
                <select value={u.roles?.[0] ?? ''} onChange={(e) => patch(u, { roles: [e.target.value] })} disabled={!canWrite}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </td>
              <td>{u.auth_source === 'ad' ? 'AD' : 'local'}</td>
              <td>
                <button className={`pill ${u.is_active ? 'on' : ''}`} style={{ cursor: canWrite ? 'pointer' : 'default', border: 'none' }}
                  disabled={!canWrite} onClick={() => patch(u, { isActive: !u.is_active })}>
                  {u.is_active ? 'sí' : 'no'}
                </button>
              </td>
              <td className="row-actions">
                {u.auth_source === 'local' && (
                  canWrite && <IconButton icon={IconKey} label="Restablecer contraseña" onClick={() => setPwd({ user: u, password: '', error: null })} />
                )}
                {has('users:delete') && <IconButton icon={IconDelete} label="Eliminar" danger onClick={() => remove(u)} disabled={u.id === me.id} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <Pagination total={data.total} limit={list.limit} offset={list.offset} onChange={list.setPage} />
      </>
      )}

      {creating && (
        <FormModal title="Nuevo usuario" onClose={() => setCreating(false)} onSubmit={create} busy={busy} error={formErr} submitLabel="Crear">
            <label>Tipo
              <select value={form.authSource} onChange={set('authSource')}>
                <option value="local">Local (contraseña en DBRefresh)</option>
                <option value="ad">Active Directory</option>
              </select>
            </label>
            <label>Rol
              <select value={form.role} onChange={set('role')}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            {isAd ? (
              <>
                {!adReady && (
                  <div className="alert warn small full">
                    AD no está habilitado en Ajustes: puedes crear el usuario, pero no podrá entrar hasta configurarlo.
                  </div>
                )}
                <label>Usuario de red
                  <input className="mono" value={form.username} onChange={set('username')} placeholder="DOMINIO\usuario o usuario" autoFocus required />
                  <span className="field-hint">Se guarda sin dominio (sAMAccountName). La contraseña la valida AD.</span>
                </label>
                <label>Email (opcional)
                  <input type="email" value={form.email} onChange={set('email')} />
                  <span className="field-hint">Si lo dejas vacío se completa desde AD en el primer inicio de sesión (si hay base de búsqueda).</span>
                </label>
              </>
            ) : (
              <>
                <label>Email<input type="email" value={form.email} onChange={set('email')} autoFocus required /></label>
                <label>Password (mín. 10)<input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" required /></label>
              </>
            )}
            <label className="full">Nombre<input value={form.fullName} onChange={set('fullName')} /></label>
        </FormModal>
      )}

      {pwd && (
        <FormModal title="Restablecer contraseña" size="sm" onClose={() => setPwd(null)} onSubmit={resetPwd} busy={busy} error={pwd.error}>
          <label className="full">Nuevo password para {label(pwd.user)}
            <input type="password" value={pwd.password} autoComplete="new-password" autoFocus required
              onChange={(e) => setPwd((p) => ({ ...p, password: e.target.value }))} />
            <span className="field-hint">Mínimo 10 caracteres.</span>
          </label>
        </FormModal>
      )}
    </div>
  );
}
