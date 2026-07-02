import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertNonEmpty, assertSafeName, assertOneOf, SAFE_NAME } from '../server/lib/validation.js';
import { ValidationError } from '../server/domain/errors.js';

test('assertNonEmpty: recorta y exige contenido', () => {
  assert.equal(assertNonEmpty('  hola  ', 'x'), 'hola');
  assert.throws(() => assertNonEmpty('', 'x'), ValidationError);
  assert.throws(() => assertNonEmpty('   ', 'x'), ValidationError);
  assert.throws(() => assertNonEmpty(undefined, 'x'), ValidationError);
  assert.throws(() => assertNonEmpty(123, 'x'), ValidationError);
});

test('assertSafeName: acepta nombres seguros, rechaza peligrosos', () => {
  assert.equal(assertSafeName('backup_2026.sql', 'f'), 'backup_2026.sql');
  assert.equal(assertSafeName('mi-bd.v1', 'f'), 'mi-bd.v1');
  for (const bad of ['con espacio', 'a;drop', '../x', "a'b", 'a/b', '']) {
    assert.throws(() => assertSafeName(bad, 'f'), ValidationError, `debería rechazar: ${bad}`);
  }
});

test('SAFE_NAME: regex directa', () => {
  assert.ok(SAFE_NAME.test('abc_123.DEF-9'));
  assert.ok(!SAFE_NAME.test('a b'));
});

test('assertOneOf: valida pertenencia', () => {
  const engines = ['sqlserver', 'postgres', 'mysql'];
  assert.equal(assertOneOf('postgres', engines, 'engine'), 'postgres');
  assert.throws(() => assertOneOf('oracle', engines, 'engine'), ValidationError);
});
