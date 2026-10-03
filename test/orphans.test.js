import '../test-support/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeOrphanResult, fixOrphanUsers } from '../server/engines/sqlserver/orphans.js';
import { validateMapping } from '../server/domain/restoreMapping.js';
import { ValidationError } from '../server/domain/errors.js';

// Pool mssql simulado: responde según la consulta y registra lo ejecutado.
function fakePool({ orphans, logins, owner, failRemap = [] }) {
  const executed = [];
  return {
    executed,
    request() {
      const params = {};
      return {
        input(name, _type, value) { params[name] = value; },
        async query(sql) {
          executed.push({ sql: sql.trim().split('\n')[0], params: { ...params } });
          if (sql.includes('sys.database_principals')) return { recordset: orphans.map((name) => ({ name, type: 'S' })) };
          if (sql.includes('FROM sys.server_principals WHERE name')) {
            return { recordset: logins.includes(params.name) ? [{ found: 1 }] : [] };
          }
          if (sql.includes('ALTER USER')) {
            if (failRemap.includes(params.name)) throw new Error('permiso denegado');
            return { recordset: [] };
          }
          if (sql.includes('SUSER_SNAME')) return { recordset: [{ owner }] };
          return { recordset: [] };
        },
      };
    },
  };
}

test('fixOrphanUsers: remapea con login, omite sin login y aísla errores', async () => {
  const pool = fakePool({ orphans: ['app', 'reporting', 'legacy', 'roto'], logins: ['app', 'reporting', 'roto'], owner: 'sqlserver', failRemap: ['roto'] });
  const r = await fixOrphanUsers(pool, { database: 'IFRS17' });
  assert.equal(r.orphans, 4);
  assert.deepEqual(r.remapped, ['app', 'reporting']);
  assert.deepEqual(r.skipped, ['legacy']);
  assert.deepEqual(r.errors.map((e) => e.user), ['roto']);
  assert.equal(r.owner.status, 'ok');
  // Los nombres viajan como parámetros (QUOTENAME en el servidor), nunca concatenados.
  const remaps = pool.executed.filter((e) => e.params.name && !e.sql.startsWith('SELECT'));
  assert.ok(remaps.every((e) => !e.sql.includes(e.params.name)));
});

test('fixOrphanUsers: owner huérfano se corrige solo si se indicó un login', async () => {
  const sinLogin = await fixOrphanUsers(fakePool({ orphans: [], logins: [], owner: null }), { database: 'X' });
  assert.equal(sinLogin.owner.status, 'skipped');
  const pool = fakePool({ orphans: [], logins: [], owner: null });
  const conLogin = await fixOrphanUsers(pool, { database: 'X', dbOwner: 'sqlserver' });
  assert.deepEqual(conLogin.owner, { status: 'fixed', detail: 'sqlserver' });
  assert.ok(pool.executed.some((e) => e.params.owner === 'sqlserver' && e.params.db === 'X'));
});

test('describeOrphanResult: resumen y avisos para el log', () => {
  const lines = describeOrphanResult('IFRS17', {
    orphans: 3, remapped: ['app'], skipped: ['legacy'], errors: [{ user: 'roto', message: 'x' }],
    owner: { status: 'skipped', detail: 'sin login' },
  });
  assert.equal(lines[0][0], 'info');
  assert.match(lines[0][1], /3 detectado\(s\), 1 remapeado\(s\), 1 sin login, 1 con error/);
  assert.ok(lines.filter(([lvl]) => lvl === 'warning').length >= 3);
  assert.deepEqual(describeOrphanResult('A', { orphans: 0, remapped: [], skipped: [], errors: [], owner: { status: 'ok' } }),
    [['info', 'Usuarios huérfanos en A: ninguno.']]);
});

test('validateMapping: corrección de huérfanos solo en SQL Server y login owner seguro', () => {
  const [it] = validateMapping('sqlserver', [{ backupFile: 'a.bak', targetDb: 'x', fixOrphans: true, dbOwner: 'DOM\svc_app' }]);
  assert.equal(it.fixOrphans, true);
  assert.equal(it.dbOwner, 'DOM\svc_app');
  assert.equal(validateMapping('sqlserver', [{ backupFile: 'a.bak', targetDb: 'x' }])[0].fixOrphans, false);
  assert.throws(() => validateMapping('postgres', [{ backupFile: 'a.sql', targetDb: 'x', fixOrphans: true }]), ValidationError);
  assert.throws(() => validateMapping('sqlserver', [{ backupFile: 'a.bak', targetDb: 'x', fixOrphans: true, dbOwner: 'x]; DROP' }]), ValidationError);
});
