import '../test-support/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGsUri, normalizeBucketLocation, dirPrefix } from '../server/gcp/storage.client.js';
import { DomainError } from '../server/domain/errors.js';
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

test('normalizeBucketLocation: separa gs://bucket/carpeta y limpia barras', () => {
  assert.deepEqual(normalizeBucketLocation('homologacion-bd-data', 'homologaciones'),
    { bucketName: 'homologacion-bd-data', basePrefix: 'homologaciones' });
  assert.deepEqual(normalizeBucketLocation('gs://homologacion-bd-data/homologaciones/', ''),
    { bucketName: 'homologacion-bd-data', basePrefix: 'homologaciones' });
  assert.deepEqual(normalizeBucketLocation('homologacion-bd-data/homologaciones', 'sub/'),
    { bucketName: 'homologacion-bd-data', basePrefix: 'homologaciones/sub' });
  assert.deepEqual(normalizeBucketLocation(' mi-bucket ', '//a//b/'), { bucketName: 'mi-bucket', basePrefix: 'a/b' });
  assert.deepEqual(normalizeBucketLocation('mi-bucket', null), { bucketName: 'mi-bucket', basePrefix: null });
});

test('normalizeBucketLocation: rechaza nombres de bucket inválidos', () => {
  for (const bad of ['', 'gs://', 'Mayus', 'a', 'con espacio']) {
    assert.throws(() => normalizeBucketLocation(bad, ''), DomainError, bad);
  }
});

test('dirPrefix: el prefijo se trata como carpeta', () => {
  assert.equal(dirPrefix('homologaciones'), 'homologaciones/');
  assert.equal(dirPrefix('/a/b/'), 'a/b/');
  assert.equal(dirPrefix(''), '');
  assert.equal(dirPrefix(undefined), '');
});
