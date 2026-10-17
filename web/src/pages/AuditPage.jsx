import { PageHead } from '../components/ui.jsx';
import { DebouncedInput, EmptyRow, ListToolbar, Pagination, SortTh } from '../components/list.jsx';
import DateRangeFilter from '../components/DateRangeFilter.jsx';
import { useList } from '../hooks/useList.js';
import { useListParams } from '../hooks/useListParams.js';

export default function AuditPage() {
  const list = useListParams({
    filters: ['from', 'to', 'action', 'entity', 'user'],
    dateFilters: ['from', 'to'],
    defaultSort: { key: 'created', dir: 'desc' },
  });
  const { data, error } = useList(`/audit?${list.apiQuery}`);
  const f = list.filters;

  return (
    <div className="page-fill">
      <PageHead info={data ? `${data.total} acción(es) registradas` : null} />
      <ListToolbar hasFilters={list.hasFilters} onClear={list.clear}>
        <DateRangeFilter from={f.from} to={f.to} onChange={(r) => list.update(r)} />
        <label>
          Acción
          <DebouncedInput value={f.action} onCommit={(action) => list.update({ action })} placeholder="p.ej. login" />
        </label>
        <label>
          Entidad
          <DebouncedInput value={f.entity} onCommit={(entity) => list.update({ entity })} placeholder="p.ej. schedules" />
        </label>
        <label>
          Usuario
          <DebouncedInput value={f.user} onCommit={(user) => list.update({ user })} />
        </label>
      </ListToolbar>
      {error && <div className="alert error">{error}</div>}
      {!data ? <div className="muted">Cargando…</div> : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <SortTh sortKey="created" firstDir="desc" {...list.sortProps}>Fecha</SortTh>
                  <SortTh sortKey="user" {...list.sortProps}>Actor</SortTh>
                  <SortTh sortKey="action" {...list.sortProps}>Acción</SortTh>
                  <SortTh sortKey="entity" {...list.sortProps}>Entidad</SortTh>
                  <SortTh sortKey="ip" {...list.sortProps}>IP</SortTh>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 && <EmptyRow colSpan={6} filtered={list.hasFilters}>Sin acciones registradas.</EmptyRow>}
                {data.items.map((e) => (
                  <tr key={e.id}>
                    <td className="muted small">{new Date(e.created_at).toLocaleString()}</td>
                    <td className="small">{e.actor_email ?? <span className="muted">—</span>}</td>
                    <td className="mono small">{e.action}</td>
                    <td className="small">{e.entity}</td>
                    <td className="mono small muted">{e.ip_address}</td>
                    <td className="mono small">{e.metadata?.status ?? e.metadata?.reason ?? ''}</td>
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
