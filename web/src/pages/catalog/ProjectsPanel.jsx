import { useState } from 'react';
import { api } from '../../api/client.js';
import { useList } from '../../hooks/useList.js';
import { FormModal, IconButton, NewButton, PageHead } from '../../components/ui.jsx';
import { IconDelete, IconEdit } from '../../components/icons.jsx';
import { useConfirm } from '../../components/ConfirmDialog.jsx';
import { useToast } from '../../components/Toast.jsx';

const empty = { projectId: '', description: '' };

export default function ProjectsPanel({ onChange }) {
  const confirm = useConfirm();
  const toast = useToast();
  const { data: projects, error, reload } = useList('/projects');
  const [editing, setEditing] = useState(null); // {id?} o null
  const [form, setForm] = useState(empty);
  const [formErr, setFormErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const openNew = () => { setForm(empty); setEditing({}); setFormErr(null); };
  const openEdit = (p) => { setForm({ projectId: p.project_id, description: p.description ?? '' }); setEditing(p); setFormErr(null); };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setFormErr(null);
    try {
      if (editing.id) await api.put(`/projects/${editing.id}`, form);
      else await api.post('/projects', form);
      setEditing(null); toast.success('Guardado'); await reload(); onChange?.();
    } catch (err) { setFormErr(err.message); }
    finally { setBusy(false); }
  };

  const remove = async (p) => {
    if (!(await confirm({ message: `¿Eliminar el proyecto ${p.project_id}?`, confirmLabel: 'Eliminar', danger: true }))) return;
    try { await api.del(`/projects/${p.id}`); await reload(); onChange?.(); }
    catch (err) { toast.error(err.message); }
  };

  if (error) return <div className="alert error">{error}</div>;
  if (!projects) return <div className="muted">Cargando…</div>;

  return (
    <div className="page-fill">
      <PageHead info={`${projects.length} proyecto(s)`}>
        <NewButton onClick={openNew}>Nuevo proyecto</NewButton>
      </PageHead>
      <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Project ID</th><th>Descripción</th><th /></tr></thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id}>
              <td className="mono">{p.project_id}</td>
              <td className="muted">{p.description}</td>
              <td className="row-actions">
                <IconButton icon={IconEdit} label="Editar" onClick={() => openEdit(p)} />
                <IconButton icon={IconDelete} label="Eliminar" danger onClick={() => remove(p)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {editing && (
        <FormModal
          title={editing.id ? 'Editar proyecto' : 'Nuevo proyecto'}
          onClose={() => setEditing(null)} onSubmit={save} busy={busy} error={formErr}
        >
          <label>Project ID<input className="mono" value={form.projectId} onChange={set('projectId')} autoFocus required /></label>
          <label>Descripción<input value={form.description} onChange={set('description')} /></label>
        </FormModal>
      )}
    </div>
  );
}
