import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useList } from '../hooks/useList.js';
import StatusBadge from '../components/StatusBadge.jsx';
import { IconButton, NewButton, PageHead } from '../components/ui.jsx';
import { IconDelete, IconEdit, IconPlay, IconSchedule } from '../components/icons.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/Toast.jsx';
import { describeSchedule, fmtInZone } from '../lib/schedule.js';
import ScheduleModal from './schedules/ScheduleModal.jsx';

/** Origen de los backups de una tarea, relativo al bucket. */
function folderOf(t) {
  const base = `gs://${t.bucket_name}${t.base_prefix ? `/${String(t.base_prefix).replace(/^\/+|\/+$/g, '')}` : ''}`;
  return t.bucket_path && t.bucket_path !== base ? t.bucket_path : base;
}

/**
 * Tareas de restore (modelo de db-keeper): primero se define y guarda la tarea
 * (qué restaurar, en /tasks/new) y desde aquí se ejecuta ahora o se programa
 * (una vez o recurrente) con el icono de calendario.
 */
export default function TasksPage() {
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const { data: tasks, error, reload } = useList('/schedules');
  const { data: instances } = useList('/instances');
  const [scheduling, setScheduling] = useState(null);

  const remove = async (t) => {
    if (!(await confirm({ message: `¿Eliminar la tarea «${t.name}»? También se elimina su programación.`, confirmLabel: 'Eliminar', danger: true }))) return;
    try { await api.del(`/schedules/${t.id}`); await reload(); toast.success('Tarea eliminada'); }
    catch (err) { toast.error(err.message); }
  };

  const run = async (t) => {
    if (!(await confirm({
      title: 'Ejecutar tarea',
      message: `¿Ejecutar ahora «${t.name}»?\n\nSe encola el restore en ${t.instance_name}: las BD de destino que existan se eliminan y se reemplazan. La programación no cambia.`,
      confirmLabel: 'Ejecutar ahora', danger: true,
    }))) return;
    try { const d = await api.post(`/schedules/${t.id}/run`); navigate(`/jobs/${d.jobId}`); }
    catch (err) { toast.error(err.message); await reload(); }
  };

  if (error) return <div className="alert error">{error}</div>;
  if (!tasks) return <div className="muted">Cargando…</div>;

  return (
    <div className="page-fill">
      <PageHead info={`${tasks.length} tarea(s) · ejecútala ahora o prográmala con el icono de calendario`}>
        <NewButton onClick={() => navigate('/tasks/new')} disabled={!instances?.length}>Nueva tarea</NewButton>
      </PageHead>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Tarea</th><th>Origen</th><th>BD</th><th>Programación</th><th>Próxima</th><th>Última</th><th /></tr>
          </thead>
          <tbody>
            {tasks.length === 0 && (
              <tr><td colSpan="7" className="muted">Sin tareas. Crea una con «Nueva tarea»: se define qué restaurar y luego se ejecuta o se programa desde aquí.</td></tr>
            )}
            {tasks.map((t) => (
              <tr key={t.id}>
                <td>
                  <div>{t.name}</div>
                  <div className="muted small">{t.project_id} / {t.instance_name} ({t.engine}{t.method === 'native' ? ' · nativo' : ''})</div>
                </td>
                <td className="mono small task-origin" title={folderOf(t)}>{folderOf(t)}</td>
                <td>
                  <div>{t.mapping?.length ?? 0}</div>
                  {t.mapping?.some((m) => m.source === 'latest') && <div className="muted small">último por patrón</div>}
                </td>
                <td>
                  <span className={t.schedule_mode === 'none' ? 'muted' : ''}>{describeSchedule(t)}</span>
                  {t.schedule_mode !== 'none' && <div className="muted small">{t.timezone}</div>}
                </td>
                <td className="small">{t.is_active && t.next_run_at ? fmtInZone(t.next_run_at, t.timezone) : <span className="muted">—</span>}</td>
                <td className="small">
                  {t.last_run_at ? (
                    <>
                      <div className="muted">{fmtInZone(t.last_run_at, t.timezone)}</div>
                      {t.last_error ? (
                        <span className="pill warn" title={t.last_error}>No se lanzó</span>
                      ) : t.last_job_ref && (
                        <Link to={`/jobs/${t.last_job_ref}`} title="Ver el job"><StatusBadge status={t.last_job_status ?? 'pending'} /></Link>
                      )}
                    </>
                  ) : <span className="muted">—</span>}
                  {t.last_error && <div className="task-error">{t.last_error}</div>}
                </td>
                <td className="row-actions">
                  <IconButton icon={IconPlay} label="Ejecutar ahora" onClick={() => run(t)} />
                  <IconButton icon={IconSchedule} label="Programar" title="Programar (fecha y hora)" onClick={() => setScheduling(t)} />
                  <IconButton icon={IconEdit} label="Editar" onClick={() => navigate(`/tasks/${t.id}/edit`)} />
                  <IconButton icon={IconDelete} label="Eliminar" danger onClick={() => remove(t)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {scheduling && (
        <ScheduleModal
          task={scheduling}
          onClose={() => setScheduling(null)}
          onSaved={async (saved) => {
            setScheduling(null);
            toast.success(saved.schedule_mode === 'none' ? `«${saved.name}» queda sin programar` : `Programada: ${describeSchedule(saved)}`);
            await reload();
          }}
        />
      )}
    </div>
  );
}
