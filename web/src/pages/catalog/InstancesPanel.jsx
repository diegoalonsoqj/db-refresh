import { useState } from 'react';
import { api } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useList } from '../../hooks/useList.js';
import { IconButton, NewButton, PageHead } from '../../components/ui.jsx';
import { IconDelete, IconEdit, IconPlug } from '../../components/icons.jsx';
import InstanceModal, { TestResult } from './InstanceModal.jsx';
import { EmptyRow, FilterSelect, ListToolbar, Pagination, SortTh } from '../../components/list.jsx';
import { useListParams } from '../../hooks/useListParams.js';
import { useConfirm } from '../../components/ConfirmDialog.jsx';
import { useToast } from '../../components/Toast.jsx';
import { ENGINES, engineLabel } from '../../lib/engines.js';

const ENGINE_OPTIONS = ENGINES.map((e) => ({ value: e.key, label: e.label }));
const STATUS_OPTIONS = [{ value: 'true', label: 'Activos' }, { value: 'false', label: 'Inactivos' }];

export default function InstancesPanel({ projects, buckets }) {
  const { has } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const list = useListParams({ filters: ['engine', 'project', 'active'], defaultSort: { key: 'project', dir: 'asc' } });
  const { data, error, reload } = useList(`/instances?${list.apiQuery}`);
  const instances = data?.items;
  const { data: credentials } = useList('/credentials');
  // null | {} (nueva) | instancia: el modal tiene las pestañas Datos, Buckets y Scripts pre/post.
  const [editing, setEditing] = useState(null);
  const [rowTest, setRowTest] = useState({}); // id -> resultado

  // Prueba la conexión guardada de una instancia.
  const testRow = async (i) => {
    setRowTest((r) => ({ ...r, [i.id]: { pending: true } }));
    let res;
    try { res = await api.post(`/instances/${i.id}/test-connection`, {}); }
    catch (err) { res = { ok: false, error: err.message }; }
    setRowTest((r) => ({ ...r, [i.id]: res }));
  };

  const remove = async (i) => {
    if (!(await confirm({ message: `¿Eliminar la instancia ${i.instance_name}?`, confirmLabel: 'Eliminar', danger: true }))) return;
    try { await api.del(`/instances/${i.id}`); await reload(); }
    catch (err) { toast.error(err.message); }
  };

  if (error) return <div className="alert error">{error}</div>;
  if (!instances) return <div className="muted">Cargando…</div>;

  return (
    <div className="page-fill">
      <PageHead info={`${data.total} instancia(s) · buckets y scripts pre/post se editan en el formulario de cada instancia`}>
        {has('catalog:write') && <NewButton onClick={() => setEditing({})} disabled={!projects.length}>Nueva instancia</NewButton>}
      </PageHead>
      <ListToolbar search={list.q} onSearch={(q) => list.update({ q })} searchPlaceholder="Instancia, proyecto, host o credencial"
        hasFilters={list.hasFilters} onClear={list.clear}>
        <FilterSelect label="Motor" value={list.filters.engine} onChange={(engine) => list.update({ engine })} options={ENGINE_OPTIONS} />
        <FilterSelect label="Proyecto" value={list.filters.project} onChange={(project) => list.update({ project })}
          options={projects.map((p) => ({ value: p.project_id, label: p.project_id }))} />
        <FilterSelect label="Estado" value={list.filters.active} onChange={(active) => list.update({ active })} options={STATUS_OPTIONS} />
      </ListToolbar>
      <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <SortTh sortKey="instance" {...list.sortProps}>Instancia</SortTh>
            <SortTh sortKey="engine" {...list.sortProps}>Motor</SortTh><th>Conexión</th>
            <SortTh sortKey="project" {...list.sortProps}>Proyecto</SortTh>
            <SortTh sortKey="status" {...list.sortProps}>Activo</SortTh><th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {instances.length === 0 && <EmptyRow colSpan={6} filtered={list.hasFilters}>Sin instancias.</EmptyRow>}
          {instances.map((i) => (
            <tr key={i.id}>
              <td className="mono">{i.instance_name}</td>
              <td>{engineLabel(i.engine)}</td>
              <td className="small">
                {i.db_host && i.credential_ref ? (
                  <>
                    <div className="mono">{i.mongo_srv ? 'mongodb+srv://' : ''}{i.db_host}{i.db_port ? `:${i.db_port}` : ''}</div>
                    <div className="muted">{i.credential_name} ({i.credential_username})</div>
                  </>
                ) : (
                  <span className="muted" title="Sin conexión SQL: solo restore, sin scripts pre/post">
                    {i.db_host ? `${i.db_host} · sin credencial` : 'No configurada'}
                  </span>
                )}
                <TestResult result={rowTest[i.id]} />
              </td>
              <td>{i.project_id}</td>
              <td><span className={`pill ${i.is_active ? 'on' : ''}`}>{i.is_active ? 'sí' : 'no'}</span></td>
              <td className="row-actions">
                {has('credentials:write') && <IconButton icon={IconPlug} label="Probar conexión" onClick={() => testRow(i)} disabled={!i.db_host || !i.credential_ref}
                  title={!i.db_host || !i.credential_ref ? 'Probar conexión: la instancia no tiene conexión SQL' : undefined} />}
                {(has('catalog:write') || has('scripts:read')) && (
                  <IconButton icon={IconEdit} label={has('catalog:write') ? 'Editar' : 'Ver'}
                    title={has('catalog:write') ? 'Editar (datos, buckets y scripts pre/post)' : 'Ver buckets y scripts pre/post'} onClick={() => setEditing(i)} />
                )}
                {has('catalog:delete') && <IconButton icon={IconDelete} label="Eliminar" danger onClick={() => remove(i)} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <Pagination total={data.total} limit={list.limit} offset={list.offset} onChange={list.setPage} />

      {editing && (
        <InstanceModal
          instance={editing}
          projects={projects}
          buckets={buckets}
          credentials={credentials}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
