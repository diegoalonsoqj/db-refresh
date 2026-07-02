import '../test-support/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import argon2 from 'argon2';
import { hashPassword } from '../server/auth/strategies/local.js';

test('hashPassword: genera un hash argon2id verificable', async () => {
  const hash = await hashPassword('P4$$w0rD-larga-de-prueba');
  assert.match(hash, /^\$argon2id\$/); // usa argon2id
  assert.equal(await argon2.verify(hash, 'P4$$w0rD-larga-de-prueba'), true);
  assert.equal(await argon2.verify(hash, 'password-incorrecto'), false);
});

test('hashPassword: dos hashes del mismo password difieren (salt)', async () => {
  const a = await hashPassword('misma-clave-123');
  const b = await hashPassword('misma-clave-123');
  assert.notEqual(a, b);
});
