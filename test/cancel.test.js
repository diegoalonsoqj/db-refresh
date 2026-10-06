import '../test-support/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { sleep, throwIfCancelled, watchCancel } from '../server/lib/cancel.js';
import { runTool } from '../server/engines/postgres/nativeTools.js';
import { JobCancelledError } from '../server/domain/errors.js';

test('sleep: termina antes si se aborta la señal', async () => {
  const ctl = new AbortController();
  const started = Date.now();
  setTimeout(() => ctl.abort(), 20);
  await sleep(5000, ctl.signal);
  assert.ok(Date.now() - started < 1000);
  await sleep(5000, ctl.signal); // ya abortada: no espera
  assert.ok(Date.now() - started < 1000);
});

test('throwIfCancelled: lanza JobCancelledError solo si se abortó', () => {
  const ctl = new AbortController();
  throwIfCancelled(ctl.signal);
  throwIfCancelled(null);
  ctl.abort();
  assert.throws(() => throwIfCancelled(ctl.signal), (err) => err instanceof JobCancelledError && err.code === 'JOB_CANCELLED');
});

test('watchCancel: aborta cuando la petición aparece y tolera fallos de consulta', async () => {
  let calls = 0;
  const errors = [];
  const w = watchCancel(async () => {
    calls += 1;
    if (calls === 1) throw new Error('BD caída');
    return calls >= 3;
  }, { intervalMs: 10, onError: (e) => errors.push(e.message) });
  try {
    await new Promise((resolve) => w.signal.addEventListener('abort', resolve, { once: true }));
    assert.equal(w.signal.aborted, true);
    assert.deepEqual(errors, ['BD caída']);
  } finally {
    w.stop();
  }
});

test('runTool: la cancelación mata el proceso y rechaza con JobCancelledError', async () => {
  const ctl = new AbortController();
  const input = new PassThrough(); // stdin que nunca termina (como un dump en streaming)
  const started = Date.now();
  const p = runTool({
    cmd: process.execPath,
    args: ['-e', 'process.stdin.resume(); setTimeout(() => {}, 60000)'],
    input,
    timeoutMs: 60_000,
    signal: ctl.signal,
  });
  setTimeout(() => ctl.abort(), 100);
  await assert.rejects(p, JobCancelledError);
  assert.ok(Date.now() - started < 5000);
  assert.equal(input.destroyed, true);
});
