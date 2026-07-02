import '../test-support/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGsUri } from '../server/gcp/storage.client.js';
import { InfraError } from '../server/domain/errors.js';

test('parseGsUri: separa bucket y prefijo', () => {
  assert.deepEqual(parseGsUri('gs://mi-bucket/pg/backups'), { bucket: 'mi-bucket', prefix: 'pg/backups' });
  assert.deepEqual(parseGsUri('gs://mi-bucket'), { bucket: 'mi-bucket', prefix: '' });
  assert.deepEqual(parseGsUri('gs://mi-bucket/'), { bucket: 'mi-bucket', prefix: '' });
});

test('parseGsUri: rechaza URIs que no son gs://', () => {
  assert.throws(() => parseGsUri('http://x/y'), InfraError);
  assert.throws(() => parseGsUri('mi-bucket/x'), InfraError);
  assert.throws(() => parseGsUri(''), InfraError);
});
