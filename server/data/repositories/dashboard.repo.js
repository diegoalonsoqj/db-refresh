// Datos del Panel (dashboard, como db-keeper) en pocas consultas, sin N+1.
import { query } from '../pool.js';

export async function getDashboard({ recentLimit = 6, upcomingLimit = 6 } = {}) {
  const [instances, tasks, jobs7d, now, recent, upcoming] = await Promise.all([
    query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE is_active)::int AS active FROM gcp_instances`),
    query(`SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE is_active AND next_run_at IS NOT NULL)::int AS scheduled
             FROM scheduled_restores`),
    query(`SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE status = 'succeeded')::int AS succeeded,
                  count(*) FILTER (WHERE status = 'succeeded' AND warning_message IS NOT NULL)::int AS warned,
                  count(*) FILTER (WHERE status = 'failed')::int AS failed,
                  count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
             FROM restore_jobs WHERE created_at >= now() - interval '7 days'`),
    query(`SELECT count(*) FILTER (WHERE status = 'running')::int AS running,
                  count(*) FILTER (WHERE status = 'pending')::int AS pending
             FROM restore_jobs WHERE status IN ('running', 'pending')`),
    query(`SELECT j.id, j.status, j.warning_message, j.engine, j.created_at, j.finished_at,
                  i.instance_name, p.project_id,
                  (SELECT count(*)::int FROM restore_job_items it WHERE it.job_ref = j.id) AS items
             FROM restore_jobs j
             JOIN gcp_instances i ON i.id = j.instance_ref
             JOIN gcp_projects  p ON p.id = i.project_ref
            ORDER BY j.created_at DESC
            LIMIT $1`, [recentLimit]),
    query(`SELECT s.id, s.name, s.schedule_mode, s.cron_expr, s.run_at, s.timezone, s.next_run_at,
                  i.instance_name
             FROM scheduled_restores s
             JOIN gcp_instances i ON i.id = s.instance_ref
            WHERE s.is_active AND s.next_run_at IS NOT NULL
            ORDER BY s.next_run_at
            LIMIT $1`, [upcomingLimit]),
  ]);

  return {
    instances: instances.rows[0],
    tasks: tasks.rows[0],
    jobs7d: jobs7d.rows[0],
    active: now.rows[0],
    recent: recent.rows,
    upcoming: upcoming.rows,
  };
}
