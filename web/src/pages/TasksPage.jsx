import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useList } from '../hooks/useList.js';
import StatusBadge from '../components/StatusBadge.jsx';
import { IconButton, NewButton, PageHead } from '../components/ui.jsx';
import { EmptyRow, FilterSelect, ListToolbar, Pagination, SortTh } from '../components/list.jsx';
import { useListParams } from '../hooks/useListParams.js';
import { IconDelete, IconEdit, IconPlay, IconSchedule } from '../components/icons.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/Toast.jsx';
import { describeSchedule, fmtInZone } from '../lib/schedule.js';
import ScheduleModal from './schedules/ScheduleModal.jsx';
import { ENGINES, engineLabel } from '../lib/engines.js';

const ENGINE_OPTIONS = ENGINES.map((e) => ({ value: e.key, label: e.label }));
const SCHEDULE_OPTIONS = [
  { value: 'none', label: 'Sin programar' },
  { value: 'once', label: 'Una vez' },
  { value: 'recurring', label: 'Recurrente' },
];

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
  const { has } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const list = useListParams({ filters: ['engine', 'schedule'], defaultSort: { key: 'name', dir: 'asc' } });
  const { data, error, reload } = useList(`/schedules?${list.apiQuery}`);
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

  const tasks = data?.items;

  return (
    <div className="page-fill">
      <PageHead info={data ? `${data.total} tarea(s) · ejecútala ahora o prográmala con el icono de calendario` : null}>
        {has('tasks:write') && <NewButton onClick={() => navigate('/tasks/new')} disabled={!instances?.length}>Nueva tarea</NewButton>}
      </PageHead>
      <ListToolbar
        search={list.q}
        onSearch={(q) => list.update({ q })}
        searchPlaceholder="Tarea, instancia o carpeta"
        hasFilters={list.hasFilters}
        onClear={list.clear}
      >
        <FilterSelect label="Motor" value={list.filters.engine} onChange={(engine) => list.update({ engine })} options={ENGINE_OPTIONS} />
        <FilterSelect label="Programación" value={list.filters.schedule} onChange={(schedule) => list.update({ schedule })} options={SCHEDULE_OPTIONS} allLabel="Todas" />
      </ListToolbar>
      {error && <div className="alert error">{error}</div>}
      {!tasks ? <div className="muted">Cargando…</div> : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <SortTh sortKey="name" {...list.sortProps}>Tarea</SortTh>
                  <th>Origen</th>
                  <th>BD</th>
                  <th>Programación</th>
                  <SortTh sortKey="next" {...list.sortProps}>Próxima</SortTh>
                  <SortTh sortKey="last" firstDir="desc" {...list.sortProps}>Última</SortTh>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {tasks.length === 0 && (
                  <EmptyRow colSpan={7} filtered={list.hasFilters}>Sin tareas. Crea una con «Nueva tarea»: se define qué restaurar y luego se ejecuta o se programa desde aquí.</EmptyRow>
                )}
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div>{t.name}</div>
                      <div className="muted small">{t.project_id} / {t.instance_name} ({engineLabel(t.engine)}{t.method === 'native' && t.engine !== 'mongodb' ? ' · nativo' : ''})</div>
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
                      {has('tasks:run') && <IconButton icon={IconPlay} label="Ejecutar ahora" primary onClick={() => run(t)} />}
                      {has('tasks:schedule') && <IconButton icon={IconSchedule} label="Programar" title="Programar (fecha y hora)" onClick={() => setScheduling(t)} />}
                      {has('tasks:write') && <IconButton icon={IconEdit} label="Editar" onClick={() => navigate(`/tasks/${t.id}/edit`)} />}
                      {has('tasks:write') && <IconButton icon={IconDelete} label="Eliminar" danger onClick={() => remove(t)} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={data.total} limit={list.limit} offset={list.offset} onChange={list.setPage} />
        </>
      )}

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
