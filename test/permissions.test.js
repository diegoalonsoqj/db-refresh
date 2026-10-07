import '../test-support/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertRoleKey, hasAll, uniqueKeys, unknownKeys } from '../server/domain/permissions.js';
import { ValidationError } from '../server/domain/errors.js';

test('assertRoleKey: minúsculas, dígitos y _; empieza por letra; 2-50', () => {
  assert.equal(assertRoleKey(' auditor_dba '), 'auditor_dba');
  for (const bad of ['', 'A', 'Auditor', '1rol', 'rol-x', 'x', 'r'.repeat(51)]) {
    assert.throws(() => assertRoleKey(bad), ValidationError, bad);
  }
});

test('uniqueKeys / unknownKeys: sin duplicados ni vacíos; detecta claves inexistentes', () => {
  assert.deepEqual(uniqueKeys([' jobs:read', 'jobs:read', '', null, 'tasks:run']), ['jobs:read', 'tasks:run']);
  assert.throws(() => uniqueKeys('jobs:read'), ValidationError);
  assert.deepEqual(unknownKeys(['jobs:read', 'x:y'], ['jobs:read', 'tasks:run']), ['x:y']);
});

test('hasAll: exige todos los permisos', () => {
  assert.equal(hasAll(new Set(['a', 'b']), ['a', 'b']), true);
  assert.equal(hasAll(['a'], ['a', 'b']), false);
  assert.equal(hasAll([], []), true);
});
