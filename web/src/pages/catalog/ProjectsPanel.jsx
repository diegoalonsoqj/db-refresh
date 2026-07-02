import { useState } from 'react';
import { api } from '../../api/client.js';
import { useList } from '../../hooks/useList.js';
import Modal from '../../components/Modal.jsx';

const empty = { projectId: '', description: '' };

export default function ProjectsPanel({ onChange }) {
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
      setEditing(null); await reload(); onChange?.();
    } catch (err) { setFormErr(err.message); }
    finally { setBusy(false); }
  };

  const remove = async (p) => {
    if (!confirm(`¿Eliminar el proyecto ${p.project_id}?`)) return;
    try { await api.del(`/projects/${p.id}`); await reload(); onChange?.(); }
    catch (err) { alert(err.message); }
  };

  if (error) return <div className="alert error">{error}</div>;
  if (!projects) return <div className="muted">Cargando…</div>;

  return (
    <div>
      <div className="toolbar">
        <span className="muted small">{projects.length} proyecto(s)</span>
        <button className="btn primary small" onClick={openNew}>+ Nuevo proyecto</button>
      </div>
      <table className="table">
        <thead><tr><th>Project ID</th><th>Descripción</th><th /></tr></thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id}>
              <td className="mono">{p.project_id}</td>
              <td className="muted">{p.description}</td>
              <td className="actions">
                <button className="btn ghost small" onClick={() => openEdit(p)}>Editar</button>
                <button className="btn ghost small" onClick={() => remove(p)}>Eliminar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <Modal title={editing.id ? 'Editar proyecto' : 'Nuevo proyecto'} onClose={() => setEditing(null)}>
          <form className="stack" onSubmit={save}>
            <label>Project ID<input value={form.projectId} onChange={set('projectId')} autoFocus required /></label>
            <label>Descripción<input value={form.description} onChange={set('description')} /></label>
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
