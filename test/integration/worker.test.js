// Concurrencia del worker contra la BD real: jobs de instancias distintas se
// toman en paralelo; los de una misma instancia, en orden. Se salta si no hay BD
// o si hay otros jobs pendientes (para no tomar jobs ajenos).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, closePool } from '../../server/data/pool.js';
import { claimNextJob, createJob, finishJob } from '../../server/data/repositories/jobs.repo.js';

const TAG = `itest-wk-${Date.now()}`;
let skip = null;
const ids = {};

before(async () => {
  try {
    await pool.query('SELECT 1');
  } catch {
    skip = 'BD no disponible';
    return;
  }
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM restore_jobs WHERE status = 'pending'");
  if (rows[0].n > 0) {
    skip = 'hay jobs pendientes ajenos en la BD';
    return;
  }
  const p = await pool.query('INSERT INTO gcp_projects (project_id) VALUES ($1) RETURNING id', [TAG]);
  ids.proj = p.rows[0].id;
  const mk = async (name) => (await pool.query(
    "INSERT INTO gcp_instances (project_ref, instance_name, engine) VALUES ($1, $2, 'sqlserver') RETURNING id",
    [ids.proj, name],
  )).rows[0].id;
  ids.instA = await mk('itest-a');
  ids.instB = await mk('itest-b');
  const job = async (instanceId) => (await createJob(
    { instanceId, engine: 'sqlserver', bucketPath: 'gs://itest/x' },
    [{ backupFile: 'a.bak', targetDb: 'a', seq: 1 }],
  )).id;
  ids.a1 = await job(ids.instA);
  ids.a2 = await job(ids.instA);
  ids.b1 = await job(ids.instB);
});

after(async () => {
  if (ids.proj) {
    await pool.query('DELETE FROM restore_jobs WHERE instance_ref = ANY($1)', [[ids.instA, ids.instB]]);
    await pool.query('DELETE FROM gcp_instances WHERE project_ref = $1', [ids.proj]);
    await pool.query('DELETE FROM gcp_projects WHERE id = $1', [ids.proj]);
  }
  await closePool();
});

test('claimNextJob: instancias distintas en paralelo, misma instancia en orden', async (t) => {
  if (skip) return t.skip(skip);
  // Tres claims simultáneos: A1 y B1 a la vez; A2 espera (su instancia está ocupada).
  const claimed = (await Promise.all([claimNextJob('w1'), claimNextJob('w2'), claimNextJob('w3')])).filter(Boolean);
  assert.deepEqual(claimed.map((j) => j.id).sort(), [ids.a1, ids.b1].sort());
  assert.equal(await claimNextJob('w4'), null);

  // Al terminar A1, ya se puede tomar A2.
  await finishJob(ids.a1, 'succeeded');
  const next = await claimNextJob('w5');
  assert.equal(next?.id, ids.a2);
  assert.equal(await claimNextJob('w6'), null);
});
