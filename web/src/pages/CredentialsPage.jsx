import { useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useList } from '../hooks/useList.js';
import { FormModal, IconButton, NewButton, PageHead } from '../components/ui.jsx';
import { IconDelete, IconEdit } from '../components/icons.jsx';
import { EmptyRow, FilterSelect, ListToolbar, Pagination, SortTh } from '../components/list.jsx';
import { useListParams } from '../hooks/useListParams.js';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/Toast.jsx';
import { ENGINES, engineLabel } from '../lib/engines.js';

// Credenciales reutilizables: las usan las instancias (IP privada + credencial)
// para scripts pre/post, el restore nativo y, en MongoDB, el restore con
// mongorestore. La contraseña nunca vuelve del servidor.
const ENGINE_OPTIONS = ENGINES.map((e) => ({ value: e.key, label: e.label }));
const KIND_OPTIONS = [{ value: 'stored', label: 'Cifrada en la app' }, { value: 'ref', label: 'Secret Manager / env' }];
const empty = { name: '', engine: 'sqlserver', username: '', secretKind: 'stored', password: '', secretRef: '', description: '' };

export default function CredentialsPage() {
  const { has } = useAuth();
  const canWrite = has('credentials:write');
  const confirm = useConfirm();
  const toast = useToast();
  const list = useListParams({ filters: ['engine', 'kind'], defaultSort: { key: 'name', dir: 'asc' } });
  const { data, error, reload } = useList(`/credentials?${list.apiQuery}`);
  const creds = data?.items;
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
      setEditing(null); toast.success('Guardado'); await reload();
    } catch (err) { setFormErr(err.message); }
    finally { setBusy(false); }
  };

  const remove = async (c) => {
    if (!(await confirm({ message: `¿Eliminar la credencial "${c.name}"?`, confirmLabel: 'Eliminar', danger: true }))) return;
    try { await api.del(`/credentials/${c.id}`); await reload(); }
    catch (err) { toast.error(err.message); }
  };

  // Al editar una credencial guardada, la contraseña es opcional (vacía = sin cambios).
  const keepsPassword = editing?.id && editing.secret_kind === 'stored' && editing.has_password;

  return (
    <div className="page-fill">
      <p className="muted small">
        Usuario y contraseña con los que la app se conecta a las instancias (por IP privada) para ejecutar
        scripts pre/post. Una credencial puede usarse en varias instancias del mismo motor. Las contraseñas se
        guardan cifradas y nunca se muestran.
      </p>
      {error && <div className="alert error">{error}</div>}
      {!creds ? <div className="muted">Cargando…</div> : (
        <>
          <PageHead info={`${data.total} credencial(es)`}>
            {canWrite && <NewButton onClick={openNew}>Nueva credencial</NewButton>}
          </PageHead>
          <ListToolbar search={list.q} onSearch={(q) => list.update({ q })} searchPlaceholder="Nombre, usuario o descripción"
            hasFilters={list.hasFilters} onClear={list.clear}>
            <FilterSelect label="Motor" value={list.filters.engine} onChange={(engine) => list.update({ engine })} options={ENGINE_OPTIONS} />
            <FilterSelect label="Contraseña" value={list.filters.kind} onChange={(kind) => list.update({ kind })} options={KIND_OPTIONS} />
          </ListToolbar>
          <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <SortTh sortKey="name" {...list.sortProps}>Nombre</SortTh>
                <SortTh sortKey="engine" {...list.sortProps}>Motor</SortTh>
                <SortTh sortKey="username" {...list.sortProps}>Usuario</SortTh><th>Contraseña</th>
                <SortTh sortKey="instances" firstDir="desc" {...list.sortProps}>Instancias</SortTh><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {creds.length === 0 && <EmptyRow colSpan={6} filtered={list.hasFilters}>Sin credenciales.</EmptyRow>}
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
                  <td className="row-actions">
                    {canWrite && <IconButton icon={IconEdit} label="Editar" onClick={() => openEdit(c)} />}
                    {canWrite && <IconButton icon={IconDelete} label="Eliminar" danger onClick={() => remove(c)} disabled={c.instance_count > 0}
                      title={c.instance_count > 0 ? 'Eliminar: en uso por instancias' : undefined} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <Pagination total={data.total} limit={list.limit} offset={list.offset} onChange={list.setPage} />
        </>
      )}

      {editing && (
        <FormModal
          title={editing.id ? 'Editar credencial' : 'Nueva credencial'}
          onClose={() => setEditing(null)} onSubmit={save} busy={busy} error={formErr} autoComplete="off"
        >
            <label className="full">Nombre<input value={form.name} onChange={set('name')} placeholder="p.ej. sqlserver-homologacion" autoFocus required /></label>
            <label>Motor
              <select value={form.engine} onChange={set('engine')} disabled={editing.instance_count > 0}>
                {ENGINES.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
              </select>
            </label>
            <label>Usuario<input className="mono" value={form.username} onChange={set('username')} required /></label>
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
              <label className="full">Referencia
                <input className="mono" value={form.secretRef} onChange={set('secretRef')} placeholder="sm://projects/<p>/secrets/<s>" required />
                <span className="field-hint">
                  <span className="mono">sm://projects/&lt;p&gt;/secrets/&lt;s&gt;[/versions/&lt;v&gt;]</span> (la service account necesita
                  el rol Secret Manager Secret Accessor) o <span className="mono">env:NOMBRE</span>.
                </span>
              </label>
            )}
            <label className="full">Descripción<input value={form.description} onChange={set('description')} placeholder="opcional" /></label>
        </FormModal>
      )}
    </div>
  );
}
