import '../test-support/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCredentialInput } from '../server/domain/credential.js';
import { DomainError, ValidationError } from '../server/domain/errors.js';

const base = { name: 'pg-admin', engine: 'postgres', username: 'postgres' };

test('credencial guardada: password obligatoria al crear, opcional al editar', () => {
  assert.throws(() => validateCredentialInput({ ...base }), ValidationError);
  const created = validateCredentialInput({ ...base, password: 's3cr3t' });
  assert.equal(created.secretKind, 'stored');
  assert.equal(created.password, 's3cr3t');
  assert.equal(created.secretRef, null);
  // Edición sin password: conserva la guardada.
  const existing = { secret_kind: 'stored', has_password: true };
  assert.equal(validateCredentialInput({ ...base }, existing).password, null);
  // Pasar de referencia a guardada exige password.
  assert.throws(() => validateCredentialInput({ ...base, secretKind: 'stored' }, { secret_kind: 'ref' }), ValidationError);
});

test('credencial por referencia: valida sm:// / env: y rechaza una contraseña en claro', () => {
  const ref = validateCredentialInput({ ...base, secretKind: 'ref', secretRef: 'sm://projects/p/secrets/s' });
  assert.equal(ref.secretRef, 'sm://projects/p/secrets/s');
  assert.equal(ref.password, null);
  assert.throws(() => validateCredentialInput({ ...base, secretKind: 'ref', secretRef: 'P4ssw0rd!' }), DomainError);
  assert.throws(() => validateCredentialInput({ ...base, secretKind: 'ref' }), ValidationError);
});

test('credencial: nombre, motor y usuario obligatorios', () => {
  assert.throws(() => validateCredentialInput({ ...base, name: ' ', password: 'x' }), ValidationError);
  assert.throws(() => validateCredentialInput({ ...base, engine: 'oracle', password: 'x' }), ValidationError);
  assert.throws(() => validateCredentialInput({ ...base, username: '', password: 'x' }), ValidationError);
  assert.throws(() => validateCredentialInput({ ...base, secretKind: 'otro', password: 'x' }), ValidationError);
});
