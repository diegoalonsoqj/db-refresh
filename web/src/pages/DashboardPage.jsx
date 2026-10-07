import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import {
  IconActivity, IconFailed, IconHistory, IconSchedule, IconServer, IconSuccess,
} from '../components/icons.jsx';
import { describeSchedule, fmtInZone } from '../lib/schedule.js';

const REFRESH_MS = 15_000;
const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

/**
 * Panel (página de inicio, como db-keeper): indicadores de los últimos 7 días,
 * últimos restores y próximas ejecuciones programadas. Se refresca solo.
 */
export default function DashboardPage() {
  const { user } = useAuth();
  const canTasks = user && ['operator', 'admin'].includes(user.role);
  const [data, setData] = useState(null);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let stop = false;
    const load = () => {
      api.get('/dashboard').then((d) => { if (!stop) { setData(d); setError(null); } })
        .catch((e) => { if (!stop) setError(e.message); });
      api.get('/health').then((h) => { if (!stop) setHealth(h); }).catch(() => { if (!stop) setHealth(null); });
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { stop = true; clearInterval(t); };
  }, []);

  if (error && !data) return <div className="alert error">{error}</div>;
  if (!data) return <div className="muted">Cargando…</div>;

  const { instances, tasks, jobs7d, active } = data;
  const kpis = [
    { Icon: IconServer, label: 'Instancias activas', value: `${instances.active}/${instances.total}` },
    { Icon: IconSchedule, label: 'Tareas programadas', value: `${tasks.scheduled}/${tasks.total}` },
    { Icon: IconHistory, label: 'Restores (7 días)', value: jobs7d.total },
    { Icon: IconSuccess, label: 'Éxito (7 días)', value: jobs7d.successRate == null ? '—' : `${jobs7d.successRate}%`, hint: jobs7d.warned ? `${jobs7d.warned} con avisos` : null },
    { Icon: IconFailed, label: 'Fallidos (7 días)', value: jobs7d.failed, tone: jobs7d.failed ? 'err' : null },
    { Icon: IconActivity, label: 'En curso / en cola', value: `${active.running} / ${active.pending}`, tone: active.running ? 'run' : null },
  ];

  return (
    <section className="dashboard">
      <div className="kpi-grid">
        {kpis.map(({ Icon, label, value, hint, tone }) => (
          <div className={`kpi-card ${tone ? `kpi-${tone}` : ''}`} key={label}>
            <span className="kpi-icon"><Icon size={20} /></span>
            <div className="kpi-value">{value}</div>
            <div className="kpi-label">{label}</div>
            {hint && <div className="kpi-hint">{hint}</div>}
          </div>
        ))}
      </div>

      <div className="dash-cols">
        <div className="card flush">
          <div className="card-head">
            <h3>Últimos restores</h3>
            <Link to="/jobs" className="small">Ver historial</Link>
          </div>
          {data.recent.length === 0 ? (
            <p className="muted small dash-empty">Todavía no hay restores.</p>
          ) : (
            <table className="table">
              <tbody>
                {data.recent.map((j) => (
                  <tr key={j.id}>
                    <td>
                      <Link to={`/jobs/${j.id}`}>{j.instance_name}</Link>
                      <div className="muted small">{j.project_id} · {j.items} BD</div>
                    </td>
                    <td><StatusBadge status={j.status} warning={j.warning_message} /></td>
                    <td className="muted small nowrap">{fmt(j.finished_at ?? j.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card flush">
          <div className="card-head">
            <h3>Próximas ejecuciones</h3>
            {canTasks && <Link to="/tasks" className="small">Ver tareas</Link>}
          </div>
          {data.upcoming.length === 0 ? (
            <p className="muted small dash-empty">
              No hay tareas programadas.{canTasks && <> Prográmalas en <Link to="/tasks">Tareas de restore</Link>.</>}
            </p>
          ) : (
            <table className="table">
              <tbody>
                {data.upcoming.map((t) => (
                  <tr key={t.id}>
                    <td>
                      {t.name}
                      <div className="muted small">{t.instance_name}</div>
                    </td>
                    <td className="muted small">{describeSchedule(t)}</td>
                    <td className="small nowrap">{fmtInZone(t.next_run_at, t.timezone)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="dash-system muted small">
        Sistema:
        <span className="pill on">API</span>
        <span className={`pill ${health?.db ? 'on' : 'warn'}`}>BD{health?.dbLatencyMs != null ? ` · ${health.dbLatencyMs} ms` : ''}</span>
        {health?.version && <span>v{health.version}</span>}
        {error && <span className="warn-text">· {error}</span>}
      </div>
    </section>
  );
}
