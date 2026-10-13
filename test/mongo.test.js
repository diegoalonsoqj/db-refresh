import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { BSON } from 'mongodb';
import {
  assertMongoDbName, assertMongoHost, buildMongoUri, buildMongorestoreArgs, cleanMongoLine, mongoArchiveFormat,
  mongorestoreConfig, normalizeMongoOptions, parseMongoConnectionString, parseRestoreSummary, pickSourceDatabase,
} from '../server/domain/mongo.js';
import { ARCHIVE_MAGIC, parsePrelude, readArchivePrelude } from '../server/engines/mongodb/archive.js';
import { defaultMethod, validateMapping } from '../server/domain/restoreMapping.js';
import { stripBackupExt, suggestDbName } from '../web/src/lib/backupName.js';
import { suggestPattern } from '../server/domain/restoreTask.js';

/** Archivo de mongodump sintético: magic + cabecera + namespaces + terminador + cuerpo. */
function fakeArchive(namespaces, body = Buffer.from('cuerpo')) {
  const magic = Buffer.alloc(4);
  magic.writeUInt32LE(ARCHIVE_MAGIC);
  const term = Buffer.alloc(4, 0xff);
  return Buffer.concat([
    magic,
    BSON.serialize({ concurrent_collections: 4, version: '0.1', server_version: '7.0.14', tool_version: '100.11.0' }),
    ...namespaces.map(([db, collection]) => BSON.serialize({ db, collection, metadata: '{}', size: 0, type: 'collection' })),
    term,
    body,
  ]);
}

test('buildMongoUri: Community, replica set y Atlas SRV; credenciales codificadas y sin BD en la ruta', () => {
  const base = { user: 'app', password: 'p@ss:w/rd', host: '10.0.0.5', port: 27017, connOptions: {} };
  assert.equal(buildMongoUri(base), 'mongodb://app:p%40ss%3Aw%2Frd@10.0.0.5:27017/?authSource=admin');
  assert.equal(
    buildMongoUri({ ...base, host: 'h1:27017,h2:27017', connOptions: { replicaSet: 'rs0' } }),
    'mongodb://app:p%40ss%3Aw%2Frd@h1:27017,h2:27017/?authSource=admin&replicaSet=rs0',
  );
  assert.equal(
    buildMongoUri({ ...base, host: 'cluster0.abc.mongodb.net', mongoSrv: true }),
    'mongodb+srv://app:p%40ss%3Aw%2Frd@cluster0.abc.mongodb.net/?authSource=admin&tls=true',
  );
  // Las opciones de la instancia pisan los valores por defecto.
  assert.match(buildMongoUri({ ...base, connOptions: { authSource: 'ventas' } }), /\?authSource=ventas$/);
});

test('opciones de conexión: lista cerrada, texto u objeto', () => {
  assert.deepEqual(normalizeMongoOptions('replicaSet=rs0&tls=true'), { replicaSet: 'rs0', tls: 'true' });
  assert.deepEqual(normalizeMongoOptions({ readPreference: 'primary' }), { readPreference: 'primary' });
  assert.throws(() => normalizeMongoOptions('maxPoolSize=5'), /no admitida/);
  assert.throws(() => normalizeMongoOptions('tls=si'), /true o false/);
  assert.throws(() => normalizeMongoOptions('appName=a&b'), /Opciones de conexión inválidas/);
});

test('host: SRV sin puerto ni lista; estándar con lista de replica set', () => {
  assert.equal(assertMongoHost('cluster0.abc.mongodb.net', true), 'cluster0.abc.mongodb.net');
  assert.throws(() => assertMongoHost('cluster0.abc.mongodb.net:27017', true), /SRV inválido/);
  assert.equal(assertMongoHost('h1:27017,h2:27018', false), 'h1:27017,h2:27018');
  assert.throws(() => assertMongoHost('mongodb://h1', false), /Host inválido/);
});

test('parseMongoConnectionString: cadena de Atlas sin devolver la contraseña', () => {
  const p = parseMongoConnectionString('mongodb+srv://<db_username>:<db_password>@cluster0.abc.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0&foo=1');
  assert.equal(p.srv, true);
  assert.equal(p.host, 'cluster0.abc.mongodb.net');
  assert.equal(p.username, null); // marcador de Atlas
  assert.deepEqual(p.options, { retryWrites: 'true', w: 'majority', appName: 'Cluster0' });
  assert.deepEqual(p.rejected, ['foo']);
  assert.ok(!JSON.stringify(p).includes('db_password'));
  const c = parseMongoConnectionString('mongodb://ventas:secreto@10.0.0.5:27018/admin?authSource=admin');
  assert.deepEqual([c.srv, c.host, c.port, c.username], [false, '10.0.0.5', 27018, 'ventas']);
  assert.ok(!JSON.stringify(c).includes('secreto'));
});

test('mongorestore: argumentos sin contraseña, renombrado de BD y config YAML', () => {
  assert.deepEqual(
    buildMongorestoreArgs({ configFile: '/tmp/x/m.yaml', gzip: true, sourceDb: 'VentasBD', targetDb: 'VentasBD_QA' }),
    ['--config=/tmp/x/m.yaml', '--archive', '--gzip', '--nsInclude=VentasBD.*',
      '--nsFrom=VentasBD.*', '--nsTo=VentasBD_QA.*', '--drop', '--stopOnError'],
  );
  // Misma BD: sin nsFrom/nsTo.
  assert.deepEqual(
    buildMongorestoreArgs({ configFile: 'c', gzip: false, sourceDb: 'app', targetDb: 'app' }),
    ['--config=c', '--archive', '--nsInclude=app.*', '--drop', '--stopOnError'],
  );
  assert.equal(mongorestoreConfig('mongodb://a:b"c\\d@h/'), 'uri: "mongodb://a:b\\"c\\\\d@h/"\n');
});

test('salida de mongorestore: sin barras de progreso ni marca de tiempo; resumen final', () => {
  assert.equal(cleanMongoLine('2026-10-13T03:18:00.123-0500\t[####....................]  VentasBD.clientes  1.2MB/5.0MB  (24.0%)'), null);
  assert.equal(cleanMongoLine('2026-10-13T03:18:00.123-0500\trestoring VentasBD.clientes from archive on stdin'),
    'restoring VentasBD.clientes from archive on stdin');
  assert.deepEqual(parseRestoreSummary('5002 document(s) restored successfully. 0 document(s) failed to restore.'), { restored: 5002, failed: 0 });
  assert.equal(parseRestoreSummary('restoring indexes'), null);
});

test('archivos: formato, BD de origen y nombres de BD', () => {
  assert.equal(mongoArchiveFormat('VentasBD_PRD_20261013_010203.archive.gz'), 'archive-gz');
  assert.equal(mongoArchiveFormat('x.archive'), 'archive');
  assert.equal(mongoArchiveFormat('x.sql.gz'), null);
  assert.equal(pickSourceDatabase([{ db: 'VentasBD' }, { db: 'VentasBD' }, { db: 'admin' }]), 'VentasBD');
  assert.throws(() => pickSourceDatabase([{ db: 'a' }, { db: 'b' }], 'f.archive'), /varias BD \(a, b\)/);
  assert.throws(() => pickSourceDatabase([{ db: 'admin' }], 'f.archive'), /no contiene colecciones/);
  assert.equal(assertMongoDbName('Ventas_QA-1'), 'Ventas_QA-1');
  assert.throws(() => assertMongoDbName('ventas.qa'), /inválido para MongoDB/);
});

test('parsePrelude: cabecera completa, incompleta y archivo ajeno', () => {
  const buf = fakeArchive([['VentasBD', 'clientes'], ['VentasBD', 'pedidos']]);
  const res = parsePrelude(buf);
  assert.equal(res.done, true);
  assert.equal(res.header.server_version, '7.0.14');
  assert.deepEqual(res.namespaces.map((n) => `${n.db}.${n.collection}`), ['VentasBD.clientes', 'VentasBD.pedidos']);
  assert.deepEqual(parsePrelude(buf.subarray(0, 30)), { done: false });
  assert.throws(() => parsePrelude(Buffer.from('-- PostgreSQL database dump')), /no es un volcado de mongodump/);
});

test('readArchivePrelude: lee en trozos, con y sin gzip, sin consumir el cuerpo', async () => {
  const buf = fakeArchive([['VentasBD', 'clientes']], Buffer.alloc(1024 * 1024, 1));
  const chunks = (b) => Readable.from(Array.from({ length: Math.ceil(b.length / 7) }, (_, i) => b.subarray(i * 7, i * 7 + 7)));
  const plain = await readArchivePrelude(chunks(buf.subarray(0, 400)), { gzip: false });
  assert.deepEqual(plain.namespaces.map((n) => n.db), ['VentasBD']);
  const gz = await readArchivePrelude(Readable.from([gzipSync(buf)]), { gzip: true });
  assert.deepEqual(gz.namespaces.map((n) => n.collection), ['clientes']);
  await assert.rejects(readArchivePrelude(Readable.from([buf.subarray(0, 20)]), { gzip: false }), /termina antes/);
});

test('validateMapping MongoDB: solo nativo, .archive(.gz), sin BD de sistema ni opciones de otros motores', () => {
  assert.equal(defaultMethod('mongodb'), 'native');
  assert.equal(defaultMethod('postgres'), 'import');
  const [it] = validateMapping('mongodb', [{ backupFile: 'VentasBD_PRD_20261013_010203.archive.gz', targetDb: 'VentasBD_QA' }], 'native');
  assert.deepEqual([it.backupFile, it.targetDb, it.scope], ['VentasBD_PRD_20261013_010203.archive.gz', 'VentasBD_QA', 'database']);
  const ok = { backupFile: 'a.archive', targetDb: 'app' };
  assert.throws(() => validateMapping('mongodb', [ok], 'import'), /import de Cloud SQL/);
  assert.throws(() => validateMapping('mongodb', [{ ...ok, backupFile: 'a.sql.gz' }], 'native'), /Formato no admitido para MongoDB/);
  assert.throws(() => validateMapping('mongodb', [{ ...ok, targetDb: 'admin' }], 'native'), /BD de sistema/);
  assert.throws(() => validateMapping('mongodb', [{ ...ok, targetDb: 'a.b' }], 'native'), /inválido para MongoDB/);
  assert.throws(() => validateMapping('mongodb', [{ ...ok, scope: 'schema', schemaName: 's' }], 'native'), /BD completa/);
  assert.throws(() => validateMapping('mongodb', [{ ...ok, importUser: 'u' }], 'native'), /solo se puede indicar en PostgreSQL/);
  assert.throws(() => validateMapping('mongodb', [{ ...ok, dropViaSql: true }], 'native'), /solo aplica a PostgreSQL/);
  // El nativo de PostgreSQL no admite archivos de Mongo.
  assert.throws(() => validateMapping('postgres', [ok], 'native'), /Formato no admitido para el restore nativo/);
});

test('nombres de backup de MongoDB (db-keeper): BD sugerida y patrón', () => {
  assert.equal(stripBackupExt('VentasBD_PRD_20261013_010203.archive.gz'), 'VentasBD_PRD_20261013_010203');
  assert.equal(suggestDbName('VentasBD_PRD_20261013_010203.archive.gz'), 'VentasBD');
  assert.equal(suggestDbName('logs_20261013_010203.archive'), 'logs');
  assert.equal(suggestPattern('VentasBD_PRD_20261013_010203.archive.gz'), 'VentasBD_PRD_*.archive.gz');
});
