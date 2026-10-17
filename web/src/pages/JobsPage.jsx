import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.jsx';
import { PageHead } from '../components/ui.jsx';
import { EmptyRow, FilterSelect, ListToolbar, Pagination, SortTh } from '../components/list.jsx';
import DateRangeFilter from '../components/DateRangeFilter.jsx';
import { IconView } from '../components/icons.jsx';
import { useListParams } from '../hooks/useListParams.js';
import { ENGINES, engineLabel, methodLabel } from '../lib/engines.js';

const STATUSES = [
  { value: 'pending', label: 'Pendiente' },
  { value: 'running', label: 'En curso' },
  { value: 'succeeded', label: 'OK' },
  { value: 'warned', label: 'OK con avisos' },
  { value: 'failed', label: 'Fallido' },
  { value: 'cancelled', label: 'Cancelado' },
];
const ENGINE_OPTIONS = ENGINES.map((e) => ({ value: e.key, label: e.label }));

/** Duración legible de un job terminado (o en curso: hasta ahora). */
function duration(j) {
  if (!j.started_at) return null;
  const secs = Math.max(0, Math.round(((j.finished_at ? new Date(j.finished_at) : new Date()) - new Date(j.started_at)) / 1000));
  if (secs < 60) return `${secs} s`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m} min ${secs % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export default function JobsPage() {
  const list = useListParams({
    filters: ['status', 'engine', 'from', 'to'],
    dateFilters: ['from', 'to'],
    defaultSort: { key: 'created', dir: 'desc' },
  });
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let stop = false;
    const load = () =>
      api.get(`/restores?${list.apiQuery}`)
        .then((d) => { if (!stop) { setData(d); setError(null); } })
        .catch((e) => { if (!stop) setError(e.message); });
    load();
    const t = setInterval(load, 5000); // refresco del historial
    return () => { stop = true; clearInterval(t); };
  }, [list.apiQuery]);

  const f = list.filters;

  return (
    <div className="page-fill">
      <PageHead info={data ? `${data.total} job(s) · se actualiza cada 5 s` : null} />
      <ListToolbar
        search={list.q}
        onSearch={(q) => list.update({ q })}
        searchPlaceholder="Instancia, proyecto o carpeta"
        hasFilters={list.hasFilters}
        onClear={list.clear}
      >
        <FilterSelect label="Estado" value={f.status} onChange={(status) => list.update({ status })} options={STATUSES} />
        <FilterSelect label="Motor" value={f.engine} onChange={(engine) => list.update({ engine })} options={ENGINE_OPTIONS} />
        <DateRangeFilter label="Creado" from={f.from} to={f.to} onChange={(r) => list.update(r)} />
      </ListToolbar>
      {error && <div className="alert error">{error}</div>}
      {!data ? <div className="muted">Cargando…</div> : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <SortTh sortKey="status" {...list.sortProps}>Estado</SortTh>
                  <SortTh sortKey="instance" {...list.sortProps}>Instancia</SortTh>
                  <SortTh sortKey="engine" {...list.sortProps}>Motor</SortTh>
                  <SortTh sortKey="requestedBy" {...list.sortProps}>Solicitado por</SortTh>
                  <SortTh sortKey="created" firstDir="desc" {...list.sortProps}>Creado</SortTh>
                  <SortTh sortKey="duration" firstDir="desc" {...list.sortProps}>Duración</SortTh>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 && <EmptyRow colSpan={7} filtered={list.hasFilters}>Sin jobs todavía.</EmptyRow>}
                {data.items.map((j) => (
                  <tr key={j.id}>
                    <td><StatusBadge status={j.status} warning={j.warning_message} /></td>
                    <td>
                      {j.instance_name}
                      <div className="muted small">{j.project_id}</div>
                    </td>
                    <td>
                      {engineLabel(j.engine)}
                      <div className="muted small">{methodLabel(j.engine, j.method)}</div>
                    </td>
                    <td className="small">{j.requested_by_name ?? <span className="muted">—</span>}</td>
                    <td className="muted small">{new Date(j.created_at).toLocaleString()}</td>
                    <td className="small">{duration(j) ?? <span className="muted">—</span>}</td>
                    <td className="row-actions">
                      <Link className="icon-action" to={`/jobs/${j.id}`} title="Ver detalle" aria-label="Ver detalle"><IconView size={16} /></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={data.total} limit={list.limit} offset={list.offset} onChange={list.setPage} />
        </>
      )}
    </div>
  );
}
