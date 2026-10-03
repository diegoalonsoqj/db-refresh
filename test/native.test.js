import '../test-support/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPgRestoreArgs, buildPsqlArgs, parseTocSchemas, pgEnv, quoteIdent } from '../server/engines/postgres/nativeTools.js';
import { nativeDumpFormat, validateMapping } from '../server/domain/restoreMapping.js';
import { createAdapter } from '../server/engines/index.js';
import { PgNativeAdapter } from '../server/engines/postgres/PgNativeAdapter.js';
import { DomainError, ValidationError } from '../server/domain/errors.js';

test('nativeDumpFormat: tar, plano y plano comprimido', () => {
  assert.equal(nativeDumpFormat('a.tar'), 'tar');
  assert.equal(nativeDumpFormat('a.SQL'), 'plain');
  assert.equal(nativeDumpFormat('a.sql.gz'), 'plain-gz');
  assert.equal(nativeDumpFormat('a.dump'), null);
  assert.equal(nativeDumpFormat('a.bak'), null);
});

test('buildPgRestoreArgs / buildPsqlArgs: sin owner/privilegios, esquema y rol opcionales', () => {
  assert.deepEqual(buildPgRestoreArgs({ database: 'app' }),
    ['--no-owner', '--no-privileges', '--exit-on-error', '--dbname', 'app']);
  assert.deepEqual(buildPgRestoreArgs({ database: 'app', schemaName: 'ventas', role: 'owner' }).slice(-4),
    ['--role', 'owner', '--schema', 'ventas']);
  const psql = buildPsqlArgs({ database: 'app', role: 'own"er' });
  assert.ok(psql.includes('ON_ERROR_STOP=1'));
  assert.ok(psql.includes('SET ROLE "own""er"'));
  assert.deepEqual(psql.slice(-2), ['--file', '-']);
});

test('pgEnv: la contraseña va en PGPASSWORD y nunca en los argumentos', () => {
  const env = pgEnv({ host: '10.0.0.1', port: 5432, user: 'u', password: 's3cr3t' });
  assert.equal(env.PGPASSWORD, 's3cr3t');
  assert.equal(env.PGHOST, '10.0.0.1');
  assert.equal(JSON.stringify(buildPgRestoreArgs({ database: 'app' })).includes('s3cr3t'), false);
  assert.equal(quoteIdent('a"b'), '"a""b"');
});

test('parseTocSchemas: esquemas declarados y de los objetos del índice', () => {
  const toc = [
    ';',
    '; Archive created at 2026-10-03',
    '215; 2615 16385 SCHEMA - ventas postgres',
    '216; 1259 16386 TABLE ventas clientes postgres',
    '217; 1259 16390 TABLE contabilidad asientos postgres',
    '3300; 0 16386 TABLE DATA ventas clientes postgres',
    '218; 1255 16400 FUNCTION public fn() postgres',
  ].join('\n');
  assert.deepEqual(parseTocSchemas(toc), ['contabilidad', 'public', 'ventas']);
  assert.deepEqual(parseTocSchemas(''), []);
});

test('validateMapping nativo: solo PostgreSQL, formatos y alcance por esquema', () => {
  const ok = validateMapping('postgres', [
    { backupFile: 'full.tar', targetDb: 'app' },
    { backupFile: 'ventas.sql', targetDb: 'otra', scope: 'schema', schemaName: 'ventas' },
  ], 'native');
  assert.deepEqual(ok.map((i) => [i.scope, i.schemaName]), [['database', null], ['schema', 'ventas']]);
  assert.throws(() => validateMapping('sqlserver', [{ backupFile: 'a.tar', targetDb: 'x' }], 'native'), ValidationError);
  assert.throws(() => validateMapping('postgres', [{ backupFile: 'a.bak', targetDb: 'x' }], 'native'), ValidationError);
  // Esquema: nombre seguro, no de sistema, solo con método nativo.
  assert.throws(() => validateMapping('postgres', [{ backupFile: 'a.tar', targetDb: 'x', scope: 'schema', schemaName: 'x;drop' }], 'native'), ValidationError);
  assert.throws(() => validateMapping('postgres', [{ backupFile: 'a.tar', targetDb: 'x', scope: 'schema', schemaName: 'pg_catalog' }], 'native'), ValidationError);
  assert.throws(() => validateMapping('postgres', [{ backupFile: 'a.sql', targetDb: 'x', scope: 'schema', schemaName: 's' }], 'import'), ValidationError);
  // Misma BD completa y por esquema en el mismo job: contradictorio.
  assert.throws(() => validateMapping('postgres', [
    { backupFile: 'a.tar', targetDb: 'app' },
    { backupFile: 'b.tar', targetDb: 'app', scope: 'schema', schemaName: 's' },
  ], 'native'), ValidationError);
  // Dos esquemas distintos de la misma BD: válido.
  assert.equal(validateMapping('postgres', [
    { backupFile: 'a.tar', targetDb: 'app', scope: 'schema', schemaName: 's1' },
    { backupFile: 'b.tar', targetDb: 'app', scope: 'schema', schemaName: 's2' },
  ], 'native').length, 2);
  assert.throws(() => validateMapping('postgres', [{ backupFile: 'a.sql', targetDb: 'x' }], 'otro'), ValidationError);
});

test('createAdapter: método nativo solo en PostgreSQL', () => {
  assert.ok(createAdapter('postgres', {}, 'native') instanceof PgNativeAdapter);
  assert.throws(() => createAdapter('mysql', {}, 'native'), DomainError);
});
