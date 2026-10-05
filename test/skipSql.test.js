import '../test-support/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqlServerAdapter } from '../server/engines/sqlserver/SqlServerAdapter.js';
import { withReason } from '../server/jobs/runJob.js';
import { DomainError } from '../server/domain/errors.js';

// Instancia sin conexión SQL configurada: verifyPostScriptsConnection falla sin tocar red.
const ctx = (skipSqlOnFailure) => {
  const logs = [];
  return {
    logs,
    instance: { instance_name: 'gccsssp10', engine: 'sqlserver', db_host: null, credential_ref: null },
    postScripts: [{ name: 'permisos', sql_text: 'SELECT 1' }],
    skipSqlOnFailure,
    log: async (level, message) => logs.push([level, message]),
  };
};

test('ensureSqlConnection: sin la opción, el fallo aborta el pre-check', async () => {
  const c = ctx(false);
  await assert.rejects(new SqlServerAdapter(c).ensureSqlConnection('1 post-script(s)'), DomainError);
});

test('ensureSqlConnection: con la opción, sigue y marca la conexión como no disponible', async () => {
  const c = ctx(true);
  const ad = new SqlServerAdapter(c);
  await ad.ensureSqlConnection('1 post-script(s)');
  assert.match(ad.sqlUnavailable, /no tiene conexión SQL/);
  assert.ok(c.logs.some(([lvl, m]) => lvl === 'warning' && /Se restaurará igualmente/.test(m)));
  // Una segunda comprobación (p.ej. para huérfanos) no repite el intento ni el aviso.
  await ad.ensureSqlConnection('la corrección de usuarios huérfanos');
  assert.equal(c.logs.filter(([lvl]) => lvl === 'warning').length, 1);
});

test('ensureSqlConnection: los pre-scripts exigen la conexión aunque se pidiera continuar sin ella', async () => {
  const c = ctx(true);
  const ad = new SqlServerAdapter(c);
  await assert.rejects(ad.ensureSqlConnection('1 pre-script(s)', { required: true }), DomainError);
  assert.equal(ad.sqlUnavailable, undefined);
});

test('withReason: no repite el motivo si el mensaje ya lo incluye', () => {
  const msg = 'No se pudo conectar a SQL Server 10.49.34.24:1433: Failed to connect to 10.49.34.24:1433 in 15000ms';
  assert.equal(withReason(msg, 'Failed to connect to 10.49.34.24:1433 in 15000ms'), msg);
  assert.equal(withReason('No se pudo eliminar la BD X', 'ERROR_RDBMS: in use'), 'No se pudo eliminar la BD X — ERROR_RDBMS: in use');
  assert.equal(withReason('falló', ''), 'falló');
});
