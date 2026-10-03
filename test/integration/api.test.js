// Tests de integración/E2E: levantan la app real en un puerto efímero y la
// ejercitan por HTTP contra la BD real (usa el .env del proyecto). Si la BD no
// está disponible, los tests se SALTAN (no fallan), para que `npm test` sea
// robusto en entornos sin PostgreSQL.
//
// NOTA: no importa `test-support/env.js` a propósito: necesita las credenciales
// REALES de la BD (vía dotenv en config), no los valores falsos de los unitarios.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../server/app.js';
import { pool, closePool } from '../../server/data/pool.js';
import { upsertLocalUser } from '../../server/data/repositories/users.repo.js';
import { hashPassword } from '../../server/auth/strategies/local.js';

const ADMIN = 'itest-admin@dbrefresh.test';
const VIEWER = 'itest-viewer@dbrefresh.test';
const PW = 'ItestPass123!';
const PROJ = `itest-proj-${Date.now()}`;

let server;
let base;
let dbOk = false;

before(async () => {
  try {
    await pool.query('SELECT 1');
    dbOk = true;
  } catch {
    return; // sin BD: los tests se saltarán
  }
  const passwordHash = await hashPassword(PW);
  await upsertLocalUser({ email: ADMIN, fullName: 'IT Admin', role: 'admin', passwordHash });
  await upsertLocalUser({ email: VIEWER, fullName: 'IT Viewer', role: 'viewer', passwordHash });

  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (dbOk) {
    await pool.query('DELETE FROM app_users WHERE email = ANY($1)', [[ADMIN, VIEWER]]);
    await pool.query('DELETE FROM gcp_projects WHERE project_id = $1', [PROJ]);
  }
  await closePool();
});

// --- helpers ---------------------------------------------------------------
function cookieOf(res) {
  const all = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')].filter(Boolean);
  const session = all.find((c) => c.startsWith('session='));
  return session ? session.split(';')[0] : null;
}

async function req(method, path, { cookie, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, res };
}

async function login(email, password) {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, cookie: cookieOf(res) };
}

// --- tests -----------------------------------------------------------------
test('GET /auth/methods es público', async (t) => {
  if (!dbOk) return t.skip('BD no disponible');
  const { status, data } = await req('GET', '/auth/methods');
  assert.equal(status, 200);
  assert.equal(data.local, true);
});

test('login con password incorrecto -> 401', async (t) => {
  if (!dbOk) return t.skip('BD no disponible');
  const { status } = await login(ADMIN, 'malo');
  assert.equal(status, 401);
});

test('login correcto setea cookie y /auth/me devuelve el usuario', async (t) => {
  if (!dbOk) return t.skip('BD no disponible');
  const { status, cookie } = await login(ADMIN, PW);
  assert.equal(status, 200);
  assert.ok(cookie, 'debe recibir la cookie de sesión');
  const me = await req('GET', '/auth/me', { cookie });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.email, ADMIN);
  assert.equal(me.data.user.role, 'admin');
});

test('sin sesión, una ruta protegida responde 401', async (t) => {
  if (!dbOk) return t.skip('BD no disponible');
  const { status } = await req('GET', '/restores');
  assert.equal(status, 401);
});

test('RBAC: viewer no puede lanzar restore (403)', async (t) => {
  if (!dbOk) return t.skip('BD no disponible');
  const { cookie } = await login(VIEWER, PW);
  const { status } = await req('POST', '/restores', { cookie, body: {} });
  assert.equal(status, 403);
});

test('cabecera de seguridad helmet presente (nosniff)', async (t) => {
  if (!dbOk) return t.skip('BD no disponible');
  const { res } = await req('GET', '/auth/methods');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null); // desactivado
});

test('CRUD de catálogo (admin): crear, listar, duplicado 409, borrar', async (t) => {
  if (!dbOk) return t.skip('BD no disponible');
  const { cookie } = await login(ADMIN, PW);

  const created = await req('POST', '/projects', { cookie, body: { projectId: PROJ, description: 'integración' } });
  assert.equal(created.status, 201);
  const id = created.data.id;

  const list = await req('GET', '/projects', { cookie });
  assert.equal(list.status, 200);
  assert.ok(list.data.some((p) => p.project_id === PROJ), 'el proyecto creado debe aparecer');

  const dup = await req('POST', '/projects', { cookie, body: { projectId: PROJ } });
  assert.equal(dup.status, 409);

  const del = await req('DELETE', `/projects/${id}`, { cookie });
  assert.equal(del.status, 204);
});

test('RBAC: viewer no puede crear proyecto (403)', async (t) => {
  if (!dbOk) return t.skip('BD no disponible');
  const { cookie } = await login(VIEWER, PW);
  const { status } = await req('POST', '/projects', { cookie, body: { projectId: 'x' } });
  assert.equal(status, 403);
});

test('post-scripts por instancia (admin): CRUD, validación, 409 y RBAC viewer 403', async (t) => {
  if (!dbOk) return t.skip('BD no disponible');
  const { cookie } = await login(ADMIN, PW);
  const proj = await req('POST', '/projects', { cookie, body: { projectId: `${PROJ}-ps` } });
  const inst = await req('POST', '/instances', {
    cookie,
    body: {
      projectRef: proj.data.id, instanceName: 'itest-mssql', engine: 'sqlserver',
      dbHost: '10.0.0.1', adminUser: 'sqlserver', secretRef: 'env:ITEST_NOPE',
    },
  });
  assert.equal(inst.status, 201);
  const base = `/instances/${inst.data.id}/post-scripts`;
  try {
    const body = { name: 'permisos', sqlText: "PRINT 'x'\nGO\nSELECT 1", sortOrder: 10 };
    const created = await req('POST', base, { cookie, body });
    assert.equal(created.status, 201);
    assert.equal(created.data.database_name, null);

    assert.equal((await req('POST', base, { cookie, body })).status, 409);
    assert.equal((await req('POST', base, { cookie, body: { name: 'v', sqlText: '\nGO\n' } })).status, 422);
    assert.equal((await req('POST', base, { cookie, body: { name: 'v', sqlText: 'SELECT 1', databaseName: 'x;DROP' } })).status, 422);

    const upd = await req('PUT', `${base}/${created.data.id}`, {
      cookie, body: { ...body, databaseName: 'msdb', isActive: false },
    });
    assert.equal(upd.status, 200);
    assert.equal(upd.data.database_name, 'msdb');

    const list = await req('GET', base, { cookie });
    assert.equal(list.data.length, 1);

    const viewer = await login(VIEWER, PW);
    assert.equal((await req('GET', base, { cookie: viewer.cookie })).status, 403);

    assert.equal((await req('DELETE', `${base}/${created.data.id}`, { cookie })).status, 204);
  } finally {
    // ON DELETE CASCADE limpia los post-scripts que queden.
    await req('DELETE', `/instances/${inst.data.id}`, { cookie });
    await req('DELETE', `/projects/${proj.data.id}`, { cookie });
  }
});

test('instancias sin conexión SQL (solo restore) y buckets con ruta gs:// pegada', async (t) => {
  if (!dbOk) return t.skip('BD no disponible');
  const { cookie } = await login(ADMIN, PW);
  const proj = await req('POST', '/projects', { cookie, body: { projectId: `${PROJ}-nc` } });
  const ids = { inst: null, bucket: null };
  try {
    const projectRef = proj.data.id;
    // Sin host/usuario/secret: válida (el import va por el Admin API).
    const inst = await req('POST', '/instances', {
      cookie, body: { projectRef, instanceName: 'itest-nocreds', engine: 'sqlserver' },
    });
    assert.equal(inst.status, 201);
    ids.inst = inst.data.id;
    assert.equal(inst.data.db_host, null);
    assert.equal(inst.data.secret_ref, null);

    // Conexión a medias o secret_ref mal formado: rechazados.
    const partial = { projectRef, instanceName: 'itest-partial', engine: 'sqlserver', dbHost: '10.0.0.1' };
    assert.equal((await req('POST', '/instances', { cookie, body: partial })).status, 422);
    const badRef = { ...partial, adminUser: 'sqlserver', secretRef: 'P4ssw0rd' };
    assert.equal((await req('POST', '/instances', { cookie, body: badRef })).status, 400);

    // Post-script activo sin conexión SQL: 422; inactivo: permitido.
    const ps = `/instances/${ids.inst}/post-scripts`;
    const script = { name: 'job', sqlText: 'SELECT 1' };
    assert.equal((await req('POST', ps, { cookie, body: script })).status, 422);
    const inactive = await req('POST', ps, { cookie, body: { ...script, isActive: false } });
    assert.equal(inactive.status, 201);

    // Con conexión completa se puede activar; quitarla con scripts activos: 422.
    const creds = { projectRef, instanceName: 'itest-nocreds', engine: 'sqlserver',
      dbHost: '10.0.0.1', adminUser: 'sqlserver', secretRef: 'env:ITEST_NOPE' };
    assert.equal((await req('PUT', `/instances/${ids.inst}`, { cookie, body: creds })).status, 200);
    assert.equal((await req('PUT', `${ps}/${inactive.data.id}`, { cookie, body: script })).status, 200);
    const strip = { projectRef, instanceName: 'itest-nocreds', engine: 'sqlserver' };
    assert.equal((await req('PUT', `/instances/${ids.inst}`, { cookie, body: strip })).status, 422);

    // Bucket: la ruta completa pegada en el nombre se separa en bucket + carpeta.
    const b = await req('POST', '/buckets', {
      cookie, body: { projectRef, bucketName: 'gs://itest-bucket/homologaciones/' },
    });
    assert.equal(b.status, 201);
    ids.bucket = b.data.id;
    assert.equal(b.data.bucket_name, 'itest-bucket');
    assert.equal(b.data.base_prefix, 'homologaciones');
  } finally {
    if (ids.inst) await req('DELETE', `/instances/${ids.inst}`, { cookie });
    if (ids.bucket) await req('DELETE', `/buckets/${ids.bucket}`, { cookie });
    await req('DELETE', `/projects/${proj.data.id}`, { cookie });
  }
});

test('usuarios AD: alta por admin (normaliza dominio), duplicado 409, validaciones y login', async (t) => {
  if (!dbOk) return t.skip('BD no disponible');
  const { cookie } = await login(ADMIN, PW);
  const uname = `itest.ad${Date.now() % 100000}`;

  const created = await req('POST', '/users', {
    cookie, body: { authSource: 'ad', username: `EMPRESA\\${uname.toUpperCase()}`, role: 'operator' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.username, uname);
  assert.equal(created.data.auth_source, 'ad');
  assert.equal(created.data.email, null);
  try {
    assert.equal((await req('POST', '/users', { cookie, body: { authSource: 'ad', username: `${uname}@empresa.com` } })).status, 409);
    assert.equal((await req('POST', '/users', { cookie, body: { authSource: 'ad', username: 'x', password: 'abcdefghijk' } })).status, 422);
    assert.equal((await req('POST', '/users', { cookie, body: { authSource: 'ad', username: 'a*b' } })).status, 422);

    // Sin AD válido (o con contraseña errónea) el login AD responde 401 genérico.
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `EMPRESA\\${uname}`, password: 'no-es-la-clave' }),
    });
    assert.equal(res.status, 401);

    // Un usuario local entra con el campo `username` (login único).
    const local = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN, password: PW }),
    });
    assert.equal(local.status, 200);
  } finally {
    await req('DELETE', `/users/${created.data.id}`, { cookie });
  }
});
