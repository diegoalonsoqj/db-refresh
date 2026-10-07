import { useState } from 'react';
import { api } from '../../api/client.js';
import { useList } from '../../hooks/useList.js';
import { IconButton, NewButton, PageHead } from '../../components/ui.jsx';
import { IconDelete, IconEdit, IconPlug } from '../../components/icons.jsx';
import InstanceModal, { TestResult } from './InstanceModal.jsx';
import { useConfirm } from '../../components/ConfirmDialog.jsx';
import { useToast } from '../../components/Toast.jsx';

export default function InstancesPanel({ projects, buckets }) {
  const confirm = useConfirm();
  const toast = useToast();
  const { data: instances, error, reload } = useList('/instances');
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
      <PageHead info={`${instances.length} instancia(s) · buckets y scripts pre/post se editan en el formulario de cada instancia`}>
        <NewButton onClick={() => setEditing({})} disabled={!projects.length}>Nueva instancia</NewButton>
      </PageHead>
      <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Instancia</th><th>Motor</th><th>Conexión SQL</th><th>Proyecto</th><th>Activo</th><th /></tr></thead>
        <tbody>
          {instances.map((i) => (
            <tr key={i.id}>
              <td className="mono">{i.instance_name}</td>
              <td>{i.engine}</td>
              <td className="small">
                {i.db_host && i.credential_ref ? (
                  <>
                    <div className="mono">{i.db_host}{i.db_port ? `:${i.db_port}` : ''}</div>
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
                <IconButton icon={IconPlug} label="Probar conexión" onClick={() => testRow(i)} disabled={!i.db_host || !i.credential_ref}
                  title={!i.db_host || !i.credential_ref ? 'Probar conexión: la instancia no tiene conexión SQL' : undefined} />
                <IconButton icon={IconEdit} label="Editar" title="Editar (datos, buckets y scripts pre/post)" onClick={() => setEditing(i)} />
                <IconButton icon={IconDelete} label="Eliminar" danger onClick={() => remove(i)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

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
