import '../test-support/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSqlBatches } from '../server/lib/sqlBatches.js';
import { parseSecretRef, resolveSecret } from '../server/lib/secrets.js';
import { activeOperations } from '../server/gcp/cloudsql.client.js';
import { EngineAdapter } from '../server/engines/EngineAdapter.js';
import { DomainError } from '../server/domain/errors.js';
import { missingSqlCredentials } from '../server/domain/instance.js';
import { SqlServerAdapter } from '../server/engines/sqlserver/SqlServerAdapter.js';
import { PostgresAdapter } from '../server/engines/postgres/PostgresAdapter.js';
import { sqlRunnerFor } from '../server/engines/sql/runners.js';

test('splitSqlBatches: separa por GO en línea sola (LF, CRLF, mayúsculas, ;)', () => {
  const sql = "PRINT 'a';\nGO\nEXEC x;\r\n  go  \r\nSELECT 1;\nGO;\n";
  assert.deepEqual(splitSqlBatches(sql), ["PRINT 'a';", 'EXEC x;', 'SELECT 1;']);
});

test('splitSqlBatches: GO dentro de una línea o identificador no corta', () => {
  const sql = "SELECT 'GO' AS GOAL;\nEXEC msdb.dbo.sp_start_job @job_name = 'GO live';";
  assert.equal(splitSqlBatches(sql).length, 1);
});

test('splitSqlBatches: script real de homologación (GO final sin salto de línea)', () => {
  const sql = "PRINT 'x';\n\nEXEC msdb.dbo.sp_start_job @job_name = 'Permisos';\n\nPRINT 'y';\nGO";
  assert.equal(splitSqlBatches(sql).length, 1);
  assert.deepEqual(splitSqlBatches('﻿GO\n\nGO'), []);
});

test('parseSecretRef: Secret Manager con y sin versión, y env', () => {
  assert.deepEqual(parseSecretRef('sm://projects/p1/secrets/csql-pass'), {
    kind: 'sm',
    name: 'projects/p1/secrets/csql-pass/versions/latest',
  });
  assert.deepEqual(parseSecretRef('sm://projects/p1/secrets/s/versions/3'), {
    kind: 'sm',
    name: 'projects/p1/secrets/s/versions/3',
  });
  assert.deepEqual(parseSecretRef(' env:CSQL_PASS '), { kind: 'env', name: 'CSQL_PASS' });
});

test('parseSecretRef: rechaza referencias inválidas (incl. password en claro)', () => {
  for (const bad of ['', 'P4ssw0rd!', 'sm://projects/p1', 'env:1BAD', 'env:A-B', 'sm://projects/p/secrets/s/../x']) {
    assert.throws(() => parseSecretRef(bad), DomainError, bad);
  }
});

test('resolveSecret env: lee la variable y falla si no existe', async () => {
  process.env.ITEST_SECRET_X = 'valor';
  assert.equal(await resolveSecret('env:ITEST_SECRET_X'), 'valor');
  delete process.env.ITEST_SECRET_X;
  await assert.rejects(resolveSecret('env:ITEST_SECRET_X'), DomainError);
});

test('activeOperations: solo PENDING/RUNNING', () => {
  const ops = [
    { name: 'a', status: 'DONE' },
    { name: 'b', status: 'RUNNING' },
    { name: 'c', status: 'PENDING' },
    { name: 'd', status: 'SQL_OPERATION_STATUS_UNSPECIFIED' },
  ];
  assert.deepEqual(activeOperations(ops).map((o) => o.name), ['b', 'c']);
  assert.deepEqual(activeOperations(), []);
});

test('EngineAdapter: post-scripts en motor sin soporte fallan; sin scripts es no-op', async () => {
  const ctx = { instance: { instance_name: 'i1' }, postScripts: [] };
  await new EngineAdapter(ctx).runPostScripts();
  ctx.postScripts = [{ name: 's', sql_text: 'SELECT 1' }];
  await assert.rejects(new EngineAdapter(ctx).verifyPostScriptsConnection(), DomainError);
  await assert.rejects(new EngineAdapter(ctx).runPostScripts(), DomainError);
});

test('EngineAdapter: pre-scripts separados de los post; sin scripts es no-op', async () => {
  const ctx = { instance: { instance_name: 'i1' }, postScripts: [{ name: 'p', sql_text: 'SELECT 1' }] };
  const ad = new EngineAdapter(ctx);
  assert.deepEqual(ad.preScripts, []);
  await ad.runPreScripts(); // no-op: los post no se ejecutan como pre
  ctx.preScripts = [{ name: 'pre', phase: 'pre', sql_text: 'SELECT 1' }];
  await assert.rejects(new EngineAdapter(ctx).runPreScripts(), DomainError);
});

test('missingSqlCredentials: host + credencial', () => {
  assert.deepEqual(missingSqlCredentials({ db_host: 'h', credential_ref: 'c' }), []);
  assert.deepEqual(missingSqlCredentials({ db_host: 'h' }), ['credential_ref']);
  assert.deepEqual(missingSqlCredentials(null), ['db_host', 'credential_ref']);
});

test('sqlRunner: los 3 motores tienen cliente SQL para post-scripts', () => {
  for (const engine of ['sqlserver', 'postgres', 'mysql']) {
    const runner = sqlRunnerFor(engine);
    assert.equal(typeof runner.withConnection, 'function', engine);
    assert.equal(typeof runner.runBatch, 'function', engine);
  }
  assert.equal(sqlRunnerFor('oracle'), null);
  assert.equal(sqlRunnerFor('postgres').defaultDatabase, 'postgres');
  assert.equal(sqlRunnerFor('sqlserver').defaultDatabase, 'master');
});

test('post-scripts sin conexión SQL fallan en el pre-check sin conectar (SQL Server y PostgreSQL)', async () => {
  const ctx = {
    instance: { instance_name: 'i1', engine: 'sqlserver', db_host: null, credential_ref: null },
    postScripts: [{ name: 's', sql_text: 'SELECT 1' }],
    log: async () => {},
  };
  await assert.rejects(
    new SqlServerAdapter(ctx).verifyPostScriptsConnection(),
    (err) => err instanceof DomainError && err.code === 'POST_SCRIPTS_NO_CREDENTIALS',
  );
  const pgCtx = { ...ctx, instance: { ...ctx.instance, engine: 'postgres', db_host: '10.0.0.1' } };
  await assert.rejects(
    new PostgresAdapter(pgCtx).verifyPostScriptsConnection(),
    (err) => err instanceof DomainError && err.code === 'POST_SCRIPTS_NO_CREDENTIALS',
  );
});
