import { useState } from 'react';
import { api } from '../api/client.js';
import { useList } from '../hooks/useList.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { FormModal, IconButton, NewButton, PageHead } from '../components/ui.jsx';
import { EmptyRow, FilterSelect, ListToolbar, Pagination, SortTh } from '../components/list.jsx';
import { useListParams } from '../hooks/useListParams.js';
import { IconDelete, IconEdit } from '../components/icons.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/Toast.jsx';

const AUTH_OPTIONS = [{ value: 'local', label: 'Local' }, { value: 'ad', label: 'AD' }];
const STATUS_OPTIONS = [{ value: 'true', label: 'Activos' }, { value: 'false', label: 'Inactivos' }];
const empty = { id: null, authSource: 'local', email: '', username: '', fullName: '', password: '', isActive: true, roles: ['viewer'] };

/**
 * Usuarios (como db-keeper): listado con filtros y un modal para crear/editar con
 * varios roles (los permisos son la unión). El password de un usuario local se
 * cambia desde el mismo modal (vacío = no se cambia).
 */
export default function UsersPage() {
  const confirm = useConfirm();
  const toast = useToast();
  const { user: me, has } = useAuth();
  const canWrite = has('users:write');
  const canDelete = has('users:delete');
  const list = useListParams({ filters: ['role', 'authSource', 'active'], defaultSort: { key: 'user', dir: 'asc' } });
  const { data, error, reload } = useList(`/users?${list.apiQuery}`);
  const users = data?.items;
  const { data: roleList } = useList(has('roles:read') || canWrite ? '/roles' : null);
  const roleName = (key) => roleList?.find((r) => r.key === key)?.name ?? key;
  const { data: ad } = useList(has('settings:read') ? '/settings/ad' : null);
  const [form, setForm] = useState(null);
  const [formErr, setFormErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const toggleRole = (key) => setForm((f) => ({
    ...f, roles: f.roles.includes(key) ? f.roles.filter((r) => r !== key) : [...f.roles, key],
  }));

  const open = (u) => {
    setFormErr(null);
    setForm(u ? {
      id: u.id, authSource: u.auth_source, email: u.email ?? '', username: u.username ?? '',
      fullName: u.full_name ?? '', password: '', isActive: u.is_active, roles: u.roles ?? [],
    } : { ...empty });
  };

  const isAd = form?.authSource === 'ad';
  const isSelf = form?.id === me.id;
  const adReady = !ad || Boolean(ad.enabled && ad.url);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.roles.length) { setFormErr('Asigna al menos un rol al usuario'); return; }
    setBusy(true); setFormErr(null);
    const body = {
      fullName: form.fullName,
      email: isAd ? form.email || null : form.email,
      isActive: form.isActive,
      // Los propios roles no se pueden cambiar: no se envían.
      ...(isSelf ? {} : { roles: form.roles }),
      ...(!isAd && form.password ? { password: form.password } : {}),
    };
    try {
      if (form.id) await api.patch(`/users/${form.id}`, body);
      else await api.post('/users', { ...body, authSource: form.authSource, ...(isAd ? { username: form.username } : {}) });
      setForm(null);
      toast.success(form.id ? 'Guardado' : 'Usuario creado');
      await reload();
    } catch (err) { setFormErr(err.message); }
    finally { setBusy(false); }
  };

  const label = (u) => (u.auth_source === 'ad' ? u.username : u.email);

  const remove = async (u) => {
    if (!(await confirm({ message: `¿Eliminar a ${label(u)}? Su historial (jobs, auditoría) se conserva sin autor.`, confirmLabel: 'Eliminar', danger: true }))) return;
    try { await api.del(`/users/${u.id}`); await reload(); toast.success('Usuario eliminado'); }
    catch (err) { toast.error(err.message); }
  };

  const roleOptions = (roleList ?? []).map((r) => ({ value: r.key, label: r.name }));

  return (
    <div className="page-fill">
      <PageHead info={data ? `${data.total} usuario(s)` : null}>
        {canWrite && <NewButton onClick={() => open(null)}>Nuevo usuario</NewButton>}
      </PageHead>
      <ListToolbar
        search={list.q}
        onSearch={(q) => list.update({ q })}
        searchPlaceholder="Usuario, email o nombre"
        hasFilters={list.hasFilters}
        onClear={list.clear}
      >
        {roleList && <FilterSelect label="Rol" value={list.filters.role} onChange={(role) => list.update({ role })} options={roleOptions} />}
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
                  <SortTh sortKey="authSource" {...list.sortProps}>Tipo</SortTh>
                  <th>Roles</th>
                  <SortTh sortKey="status" {...list.sortProps}>Estado</SortTh>
                  {(canWrite || canDelete) && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && <EmptyRow colSpan={canWrite || canDelete ? 6 : 5} filtered={list.hasFilters} />}
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="mono small">
                      {label(u)}
                      {u.auth_source === 'ad' && u.email && <div className="muted">{u.email}</div>}
                      {u.id === me.id && <span className="pill" style={{ marginLeft: 6 }}>tú</span>}
                    </td>
                    <td>{u.full_name ?? <span className="muted">—</span>}</td>
                    <td>{u.auth_source === 'ad' ? 'AD' : 'Local'}</td>
                    <td>
                      <div className="pill-list">
                        {u.roles?.length ? u.roles.map((r) => <span key={r} className="pill">{roleName(r)}</span>) : <span className="muted">—</span>}
                      </div>
                    </td>
                    <td><span className={`pill ${u.is_active ? 'on' : ''}`}>{u.is_active ? 'Activo' : 'Inactivo'}</span></td>
                    {(canWrite || canDelete) && (
                      <td className="row-actions">
                        {canWrite && <IconButton icon={IconEdit} label="Editar" onClick={() => open(u)} />}
                        {canDelete && <IconButton icon={IconDelete} label="Eliminar" danger onClick={() => remove(u)} disabled={u.id === me.id} />}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={data.total} limit={list.limit} offset={list.offset} onChange={list.setPage} />
        </>
      )}

      {form && (
        <FormModal
          title={form.id ? `Editar usuario · ${form.authSource === 'ad' ? form.username : form.email}` : 'Nuevo usuario'}
          onClose={() => setForm(null)}
          onSubmit={submit}
          busy={busy}
          error={formErr}
          submitLabel={form.id ? 'Guardar' : 'Crear'}
          autoComplete="off"
        >
          {form.id ? (
            <label>Tipo
              <input value={isAd ? 'Active Directory' : 'Local (contraseña en DBRefresh)'} disabled />
            </label>
          ) : (
            <label>Tipo
              <select value={form.authSource} onChange={set('authSource')}>
                <option value="local">Local (contraseña en DBRefresh)</option>
                <option value="ad">Active Directory</option>
              </select>
            </label>
          )}
          <label className="checkline">
            <input type="checkbox" checked={form.isActive} onChange={set('isActive')} disabled={isSelf} />
            Activo
          </label>
          {isAd && !adReady && (
            <div className="alert warn small full">
              AD no está habilitado en Ajustes: el usuario existe, pero no podrá entrar hasta configurarlo.
            </div>
          )}
          {isAd && (
            <label>Usuario de red
              <input className="mono" value={form.username} onChange={set('username')} placeholder="DOMINIO\usuario o usuario"
                disabled={Boolean(form.id)} autoFocus={!form.id} required />
              <span className="field-hint">{form.id ? 'La cuenta de red no se cambia.' : 'Se guarda sin dominio (sAMAccountName). La contraseña la valida AD.'}</span>
            </label>
          )}
          <label>{isAd ? 'Email (opcional)' : 'Email'}
            <input type="email" value={form.email} onChange={set('email')} autoFocus={!isAd && !form.id} required={!isAd} />
            {isAd && <span className="field-hint">Si lo dejas vacío se completa desde AD en el primer inicio de sesión (si hay base de búsqueda).</span>}
          </label>
          {!isAd && (
            <label>{form.id ? 'Nuevo password' : 'Password'}
              <input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" required={!form.id} minLength={10} />
              <span className="field-hint">{form.id ? 'Mínimo 10 caracteres. Déjalo vacío para no cambiarlo.' : 'Mínimo 10 caracteres.'}</span>
            </label>
          )}
          <label className={isAd ? '' : 'full'}>Nombre<input value={form.fullName} onChange={set('fullName')} /></label>
          <fieldset className="role-picker full">
            <legend>Roles</legend>
            {isSelf && <div className="field-hint">No puedes cambiar tus propios roles: pídeselo a otro administrador.</div>}
            {!roleList ? <div className="muted small">Cargando roles…</div> : roleList.map((r) => {
              // Dar o quitar superadmin exige gestionar roles (lo valida también la API).
              const locked = isSelf || (r.key === 'superadmin' && !has('roles:write'));
              return (
                <label key={r.key} className={`role-option ${locked ? 'locked' : ''}`}>
                  <input type="checkbox" checked={form.roles.includes(r.key)} onChange={() => toggleRole(r.key)} disabled={locked} />
                  <span>
                    <span className="role-name">{r.name}</span>
                    {r.description && <span className="muted small"> · {r.description}</span>}
                  </span>
                </label>
              );
            })}
          </fieldset>
        </FormModal>
      )}
    </div>
  );
}
