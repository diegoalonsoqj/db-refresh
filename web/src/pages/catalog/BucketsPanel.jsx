import { useState } from 'react';
import { api } from '../../api/client.js';
import { useList } from '../../hooks/useList.js';
import { FormModal, IconButton, NewButton, PageHead } from '../../components/ui.jsx';
import { IconDelete, IconEdit } from '../../components/icons.jsx';
import { useConfirm } from '../../components/ConfirmDialog.jsx';
import { useToast } from '../../components/Toast.jsx';

const empty = { projectRef: '', bucketName: '', basePrefix: '', description: '', isActive: true };

export default function BucketsPanel({ projects, onChange }) {
  const confirm = useConfirm();
  const toast = useToast();
  const { data: buckets, error, reload } = useList('/buckets');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [formErr, setFormErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const openNew = () => { setForm({ ...empty, projectRef: projects[0]?.id ?? '' }); setEditing({}); setFormErr(null); };
  const openEdit = (b) => {
    setForm({ projectRef: b.project_ref, bucketName: b.bucket_name, basePrefix: b.base_prefix ?? '', description: b.description ?? '', isActive: b.is_active });
    setEditing(b); setFormErr(null);
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setFormErr(null);
    try {
      if (editing.id) await api.put(`/buckets/${editing.id}`, form);
      else await api.post('/buckets', form);
      setEditing(null); toast.success('Guardado'); await reload(); onChange?.();
    } catch (err) { setFormErr(err.message); }
    finally { setBusy(false); }
  };

  const remove = async (b) => {
    if (!(await confirm({ message: `¿Eliminar el bucket ${b.bucket_name}?`, confirmLabel: 'Eliminar', danger: true }))) return;
    try { await api.del(`/buckets/${b.id}`); await reload(); onChange?.(); }
    catch (err) { toast.error(err.message); }
  };

  if (error) return <div className="alert error">{error}</div>;
  if (!buckets) return <div className="muted">Cargando…</div>;

  return (
    <div className="page-fill">
      <PageHead info={`${buckets.length} bucket(s)`}>
        <NewButton onClick={openNew} disabled={!projects.length}>Nuevo bucket</NewButton>
      </PageHead>
      <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Bucket</th><th>Prefijo</th><th>Proyecto</th><th>Activo</th><th /></tr></thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.id}>
              <td className="mono">{b.bucket_name}</td>
              <td className="mono small muted">{b.base_prefix}</td>
              <td>{b.project_id}</td>
              <td><span className={`pill ${b.is_active ? 'on' : ''}`}>{b.is_active ? 'sí' : 'no'}</span></td>
              <td className="row-actions">
                <IconButton icon={IconEdit} label="Editar" onClick={() => openEdit(b)} />
                <IconButton icon={IconDelete} label="Eliminar" danger onClick={() => remove(b)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {editing && (
        <FormModal
          title={editing.id ? 'Editar bucket' : 'Nuevo bucket'}
          onClose={() => setEditing(null)} onSubmit={save} busy={busy} error={formErr}
        >
            <label>Proyecto
              <select value={form.projectRef} onChange={set('projectRef')} required>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.project_id}</option>)}
              </select>
            </label>
            <label>Nombre del bucket
              <input className="mono" value={form.bucketName} onChange={set('bucketName')} placeholder="mi-bucket" autoFocus required />
              <span className="field-hint">Solo el nombre, sin <span className="mono">gs://</span>. Si pegas la ruta completa (<span className="mono">gs://mi-bucket/carpeta</span>) se separa sola.</span>
            </label>
            <label className="full">Prefijo base (carpeta)
              <input className="mono" value={form.basePrefix} onChange={set('basePrefix')} placeholder="carpeta/subcarpeta (opcional)" />
              <span className="field-hint">Carpeta donde están los backups. Se listan los archivos de ese nivel (no de subcarpetas). Vacío = raíz del bucket.</span>
            </label>
            <label className="full">Descripción<input value={form.description} onChange={set('description')} /></label>
            <label className="checkline full">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
              Activo
            </label>
        </FormModal>
      )}
    </div>
  );
}
