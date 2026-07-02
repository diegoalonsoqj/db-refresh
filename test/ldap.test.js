import '../test-support/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeFilter } from '../server/auth/strategies/ad.js';

test('escapeFilter: deja intactos los valores normales', () => {
  assert.equal(escapeFilter('jdoe'), 'jdoe');
  assert.equal(escapeFilter('juan.perez@empresa.local'), 'juan.perez@empresa.local');
});

test('escapeFilter: neutraliza metacaracteres LDAP (anti-inyección RFC 4515)', () => {
  assert.equal(escapeFilter('*'), '\\2a');
  assert.equal(escapeFilter('('), '\\28');
  assert.equal(escapeFilter(')'), '\\29');
  assert.equal(escapeFilter('\\'), '\\5c');
  // un intento de inyección no debe dejar metacaracteres activos
  const out = escapeFilter('*)(uid=*))(|(uid=*');
  assert.ok(!/[*()]/.test(out.replace(/\\../g, '')), 'no deben quedar ( ) * sin escapar');
});
