import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DomainError, ValidationError, NotFoundError, AuthError,
  ForbiddenError, ConflictError, InfraError, isAppError,
} from '../server/domain/errors.js';

test('cada error de la app expone su status HTTP', () => {
  assert.equal(new DomainError('x').status, 400);
  assert.equal(new ValidationError('x').status, 422);
  assert.equal(new NotFoundError('x').status, 404);
  assert.equal(new AuthError().status, 401);
  assert.equal(new ForbiddenError().status, 403);
  assert.equal(new ConflictError().status, 409);
  assert.equal(new InfraError('x').status, 502);
});

test('isAppError distingue errores de la app de los genéricos', () => {
  assert.ok(isAppError(new ValidationError('x')));
  assert.ok(isAppError(new InfraError('x')));
  assert.ok(!isAppError(new Error('x')));
  assert.ok(!isAppError(null));
});

test('ValidationError transporta details', () => {
  const e = new ValidationError('faltan campos', { missing: ['a', 'b'] });
  assert.equal(e.code, 'VALIDATION_ERROR');
  assert.deepEqual(e.details, { missing: ['a', 'b'] });
});

test('NotFoundError es un DomainError con code NOT_FOUND', () => {
  const e = new NotFoundError('no está');
  assert.ok(e instanceof DomainError);
  assert.equal(e.code, 'NOT_FOUND');
});
