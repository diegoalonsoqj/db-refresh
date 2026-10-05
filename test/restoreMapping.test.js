import '../test-support/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMapping, isSystemDatabase, supportsImportUser } from '../server/domain/restoreMapping.js';
import { buildImportContext, describeGcpError, instanceRunState } from '../server/gcp/cloudsql.client.js';
import { ValidationError } from '../server/domain/errors.js';
import { buildDropStatements } from '../server/engines/postgres/dropViaSql.js';

test('validateMapping: normaliza y deja importUser en null si no viene', () => {
  assert.deepEqual(validateMapping('sqlserver', [{ backupFile: ' a.bak ', targetDb: 'ventas' }]),
    [{ backupFile: 'a.bak', targetDb: 'ventas', importUser: null, scope: 'database', schemaName: null, fixOrphans: false, dbOwner: null, dropViaSql: false }]);
});

test('validateMapping: owner solo en PostgreSQL', () => {
  assert.deepEqual(validateMapping('postgres', [{ backupFile: 'd.sql', targetDb: 'app', importUser: 'app_owner' }]),
    [{ backupFile: 'd.sql', targetDb: 'app', importUser: 'app_owner', scope: 'database', schemaName: null, fixOrphans: false, dbOwner: null, dropViaSql: false }]);
  assert.throws(() => validateMapping('mysql', [{ backupFile: 'd.sql', targetDb: 'app', importUser: 'root' }]), ValidationError);
  assert.throws(() => validateMapping('sqlserver', [{ backupFile: 'd.bak', targetDb: 'app', importUser: 'sa' }]), ValidationError);
  // usuarios IAM permitidos; inyección no
  assert.equal(validateMapping('postgres', [{ backupFile: 'd.sql', targetDb: 'app', importUser: 'sa@p.iam' }])[0].importUser, 'sa@p.iam');
  assert.throws(() => validateMapping('postgres', [{ backupFile: 'd.sql', targetDb: 'app', importUser: 'x; DROP' }]), ValidationError);
});

test('validateMapping: rechaza BDs de sistema, destinos repetidos, nombres inseguros y vacío', () => {
  assert.throws(() => validateMapping('sqlserver', [{ backupFile: 'a.bak', targetDb: 'MASTER' }]), ValidationError);
  assert.throws(() => validateMapping('postgres', [{ backupFile: 'a.sql', targetDb: 'postgres' }]), ValidationError);
  assert.throws(() => validateMapping('mysql', [{ backupFile: 'a.sql', targetDb: 'sys' }]), ValidationError);
  assert.throws(() => validateMapping('postgres', [
    { backupFile: 'a.sql', targetDb: 'App' }, { backupFile: 'b.sql', targetDb: 'app' },
  ]), ValidationError);
  assert.throws(() => validateMapping('postgres', [{ backupFile: '../x.sql', targetDb: 'app' }]), ValidationError);
  assert.throws(() => validateMapping('postgres', []), ValidationError);
});

test('isSystemDatabase / supportsImportUser', () => {
  assert.equal(isSystemDatabase('sqlserver', 'tempdb'), true);
  assert.equal(isSystemDatabase('sqlserver', 'ventas'), false);
  assert.equal(supportsImportUser('postgres'), true);
  assert.equal(supportsImportUser('mysql'), false);
});

test('buildImportContext: importUser solo si se indica', () => {
  const base = { database: 'app', uri: 'gs://b/d.sql', fileType: 'SQL' };
  assert.equal('importUser' in buildImportContext(base), false);
  assert.equal(buildImportContext({ ...base, importUser: 'owner' }).importUser, 'owner');
  assert.equal(buildImportContext(base).kind, 'sql#importContext');
});

test('describeGcpError: operación, HTTP de googleapis y Error genérico', () => {
  assert.equal(describeGcpError({ errors: [{ code: 'ERROR_RDBMS', message: 'database in use' }] }), 'ERROR_RDBMS: database in use');
  assert.equal(describeGcpError({ response: { status: 403, data: { error: { message: 'Not authorized' } } } }), '403 Not authorized');
  assert.equal(describeGcpError(new Error('boom')), 'boom');
  assert.equal(describeGcpError(undefined), '');
});

test('instanceRunState: encendida, detenida (activationPolicy NEVER) y en mantenimiento', () => {
  assert.equal(instanceRunState({ state: 'RUNNABLE', settings: { activationPolicy: 'ALWAYS' } }).running, true);
  const stopped = instanceRunState({ state: 'RUNNABLE', settings: { activationPolicy: 'NEVER' } });
  assert.equal(stopped.running, false);
  assert.equal(stopped.reason, 'está detenida');
  const maint = instanceRunState({ state: 'MAINTENANCE', settings: { activationPolicy: 'ALWAYS' } });
  assert.equal(maint.running, false);
  assert.match(maint.reason, /MAINTENANCE/);
});

test('validateMapping: borrado por SQL solo en PostgreSQL y BD completa', () => {
  const [it] = validateMapping('postgres', [{ backupFile: 'd.sql.gz', targetDb: 'PaynovaBD', dropViaSql: true }]);
  assert.equal(it.dropViaSql, true);
  assert.equal(validateMapping('postgres', [{ backupFile: 'd.sql', targetDb: 'app', dropViaSql: 'yes' }])[0].dropViaSql, false);
  assert.throws(() => validateMapping('mysql', [{ backupFile: 'd.sql', targetDb: 'app', dropViaSql: true }]), ValidationError);
  assert.throws(() => validateMapping('sqlserver', [{ backupFile: 'a.bak', targetDb: 'app', dropViaSql: true }]), ValidationError);
  assert.throws(
    () => validateMapping('postgres', [{ backupFile: 'd.tar', targetDb: 'app', scope: 'schema', schemaName: 's1', dropViaSql: true }], 'native'),
    ValidationError,
  );
});

test('buildDropStatements: GRANT si no es miembro, FORCE en PG13+, terminate antes de PG13', () => {
  const pg16 = buildDropStatements({ database: 'PaynovaBD', owner: 'UserPaynova', isMember: false, serverVersionNum: 160011 });
  assert.deepEqual(pg16.map((s) => s.sql), [
    'GRANT "UserPaynova" TO CURRENT_USER',
    'DROP DATABASE IF EXISTS "PaynovaBD" WITH (FORCE)',
  ]);
  const member = buildDropStatements({ database: 'app', owner: 'postgres', isMember: true, serverVersionNum: 170000 });
  assert.deepEqual(member.map((s) => s.kind), ['drop']);
  const pg12 = buildDropStatements({ database: "o'db", owner: 'x', isMember: true, serverVersionNum: 120015 });
  assert.deepEqual(pg12.map((s) => s.kind), ['terminate', 'drop']);
  assert.match(pg12[0].sql, /datname = 'o''db'/);
  assert.equal(pg12[1].sql, `DROP DATABASE IF EXISTS "o'db"`);
});
