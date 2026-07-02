import '../test-support/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken } from '../server/auth/jwt.js';
import { AuthError } from '../server/domain/errors.js';

test('signToken/verifyToken: roundtrip conserva el payload', () => {
  const token = signToken({ sub: 'user-1', email: 'a@b.c', role: 'admin' });
  assert.equal(typeof token, 'string');
  const payload = verifyToken(token);
  assert.equal(payload.sub, 'user-1');
  assert.equal(payload.email, 'a@b.c');
  assert.equal(payload.role, 'admin');
  assert.ok(payload.exp > payload.iat); // tiene expiración
});

test('verifyToken: rechaza basura con AuthError', () => {
  assert.throws(() => verifyToken('no.es.jwt'), AuthError);
  assert.throws(() => verifyToken(''), AuthError);
});

test('verifyToken: rechaza token con firma manipulada', () => {
  const token = signToken({ sub: 'x' });
  const parts = token.split('.');
  parts[2] = `${parts[2].slice(0, -2)}xx`; // corrompe la firma
  assert.throws(() => verifyToken(parts.join('.')), AuthError);
});
