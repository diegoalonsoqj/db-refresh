import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { FormModal, IconButton, NewButton, PageHead } from '../components/ui.jsx';
import { IconDelete, IconEdit, IconLock } from '../components/icons.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/Toast.jsx';

const CATEGORY_LABELS = {
  users: 'Usuarios',
  roles: 'Roles',
  catalog: 'Catálogo',
  credentials: 'Credenciales',
  scripts: 'Scripts pre/post',
  tasks: 'Tareas de restore',
  jobs: 'Historial',
  settings: 'Ajustes',
  audit: 'Auditoría',
};
const SUPERADMIN = 'superadmin';
const emptyRole = { id: null, key: '', name: '', description: '', copyFrom: '' };

const sameSet = (a, b) => a.size === b.size && [...a].every((k) => b.has(k));

/**
 * Roles y permisos (como db-keeper): matriz permiso × rol con casillas y
 * «Guardar» por rol. superadmin tiene siempre todos (bloqueado). Los roles
 * personalizados se crean, renombran y eliminan aquí; los de sistema no se borran.
 */
export default function RolesPage() {
  const { has, refresh } = useAuth();
  const canWrite = has('roles:write');
  const confirm = useConfirm();
  const toast = useToast();
  const [roles, setRoles] = useState(null);
  const [perms, setPerms] = useState([]);
  const [draft, setDraft] = useState({});
  const [error, setError] = useState(null);
  const [form, setForm] = useState(null);
  const [formErr, setFormErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const [r, p] = await Promise.all([api.get('/roles'), api.get('/permissions')]);
    setRoles(r);
    setPerms(p);
    setDraft(Object.fromEntries(r.map((role) => [role.id, new Set(role.permissions)])));
  };

  useEffect(() => { reload().catch((e) => setError(e.message)); }, []);

  const categories = useMemo(() => {
    const map = new Map();
    for (const p of perms) map.set(p.category, [...(map.get(p.category) ?? []), p]);
    return [...map.entries()];
  }, [perms]);

  const dirty = (r) => draft[r.id] && !sameSet(draft[r.id], new Set(r.permissions));

  const toggle = (roleId, key) => setDraft((d) => {
    const next = new Set(d[roleId]);
    if (next.has(key)) next.delete(key); else next.add(key);
    return { ...d, [roleId]: next };
  });

  const save = async (r) => {
    try {
      await api.patch(`/roles/${r.id}`, { permissions: [...draft[r.id]] });
      toast.success(`${r.name}: permisos guardados`);
      // Si el rol es mío, el menú y las acciones cambian sin volver a entrar.
      await Promise.all([reload(), refresh?.()]);
    } catch (e) { toast.error(e.message); }
  };

  const openForm = (r) => {
    setFormErr(null);
    setForm(r ? { id: r.id, key: r.key, name: r.name, description: r.description ?? '', copyFrom: '' } : { ...emptyRole });
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setFormErr(null);
    try {
      if (form.id) {
        await api.patch(`/roles/${form.id}`, { name: form.name, description: form.description });
      } else {
        const base = roles.find((r) => r.id === form.copyFrom);
        await api.post('/roles', { key: form.key, name: form.name, description: form.description, permissions: base?.permissions ?? [] });
      }
      setForm(null);
      toast.success(form.id ? 'Guardado' : 'Rol creado: marca sus permisos en la matriz');
      await reload();
    } catch (err) { setFormErr(err.message); }
    finally { setBusy(false); }
  };

  const remove = async (r) => {
    if (!(await confirm({ message: `¿Eliminar el rol «${r.name}»?`, confirmLabel: 'Eliminar', danger: true }))) return;
    try { await api.del(`/roles/${r.id}`); toast.success('Rol eliminado'); await reload(); }
    catch (e) { toast.error(e.message); }
  };

  return (
    <div className="page-fill">
      <PageHead info={roles ? `${roles.length} rol(es) · un usuario con varios roles tiene la unión de sus permisos` : null}>
        {canWrite && <NewButton onClick={() => openForm(null)}>Nuevo rol</NewButton>}
      </PageHead>
      {error && <div className="alert error">{error}</div>}
      {!roles ? (!error && <div className="muted">Cargando…</div>) : (
        <div className="table-wrap">
          <table className="table matrix">
            <thead>
              <tr>
                <th>Permiso</th>
                {roles.map((r) => (
                  <th key={r.id} className="cell-center" title={r.description ?? ''}>
                    <div className="matrix-role">
                      <span>
                        {r.name}
                        {r.key === SUPERADMIN && <span className="matrix-lock" title="Tiene siempre todos los permisos"><IconLock size={13} /></span>}
                      </span>
                      <span className="muted small">{r.is_system ? 'sistema' : r.key} · {r.user_count} usuario(s)</span>
                      {canWrite && (
                        <span className="matrix-role-actions">
                          <IconButton icon={IconEdit} label={`Editar ${r.name}`} onClick={() => openForm(r)} />
                          {!r.is_system && (
                            <IconButton icon={IconDelete} label={`Eliminar ${r.name}`} danger onClick={() => remove(r)}
                              disabled={r.user_count > 0} title={r.user_count > 0 ? 'Está asignado a usuarios: quítaselo antes' : `Eliminar ${r.name}`} />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map(([cat, list]) => (
                <Fragment key={cat}>
                  <tr className="matrix-cat">
                    <td colSpan={roles.length + 1}>{CATEGORY_LABELS[cat] ?? cat}</td>
                  </tr>
                  {list.map((p) => (
                    <tr key={p.key}>
                      <td>
                        <div>{p.description}</div>
                        <div className="mono small muted">{p.key}</div>
                      </td>
                      {roles.map((r) => (
                        <td key={r.id} className="cell-center">
                          <input
                            type="checkbox"
                            aria-label={`${p.key} en ${r.name}`}
                            checked={draft[r.id]?.has(p.key) ?? false}
                            disabled={!canWrite || r.key === SUPERADMIN}
                            onChange={() => toggle(r.id, p.key)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
            {canWrite && (
              <tfoot>
                <tr>
                  <td />
                  {roles.map((r) => (
                    <td key={r.id} className="cell-center">
                      {r.key !== SUPERADMIN && (
                        <button type="button" className={`btn small ${dirty(r) ? 'primary' : ''}`} disabled={!dirty(r)} onClick={() => save(r)}>
                          Guardar
                        </button>
                      )}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {form && (
        <FormModal title={form.id ? `Editar rol · ${form.key}` : 'Nuevo rol'} onClose={() => setForm(null)} onSubmit={submit}
          busy={busy} error={formErr} submitLabel={form.id ? 'Guardar' : 'Crear'} autoComplete="off">
          <label>Nombre<input value={form.name} onChange={set('name')} maxLength={100} autoFocus required /></label>
          <label>Clave
            <input className="mono" value={form.key} onChange={set('key')} disabled={Boolean(form.id)} required
              pattern="[a-z][a-z0-9_]{1,49}" placeholder="p.ej. soporte_restores" />
            <span className="field-hint">{form.id ? 'La clave no se cambia.' : 'Minúsculas, números y guion bajo; empieza por letra.'}</span>
          </label>
          <label className="full">Descripción<input value={form.description} onChange={set('description')} maxLength={500} /></label>
          {!form.id && (
            <label className="full">Copiar permisos de
              <select value={form.copyFrom} onChange={set('copyFrom')}>
                <option value="">Ninguno (sin permisos)</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <span className="field-hint">Luego se ajustan en la matriz.</span>
            </label>
          )}
        </FormModal>
      )}
    </div>
  );
}
