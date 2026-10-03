import '../test-support/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMapping, isSystemDatabase, supportsImportUser } from '../server/domain/restoreMapping.js';
import { buildImportContext } from '../server/gcp/cloudsql.client.js';
import { ValidationError } from '../server/domain/errors.js';

test('validateMapping: normaliza y deja importUser en null si no viene', () => {
  assert.deepEqual(validateMapping('sqlserver', [{ backupFile: ' a.bak ', targetDb: 'ventas' }]),
    [{ backupFile: 'a.bak', targetDb: 'ventas', importUser: null }]);
});

test('validateMapping: owner solo en PostgreSQL', () => {
  assert.deepEqual(validateMapping('postgres', [{ backupFile: 'd.sql', targetDb: 'app', importUser: 'app_owner' }]),
    [{ backupFile: 'd.sql', targetDb: 'app', importUser: 'app_owner' }]);
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
