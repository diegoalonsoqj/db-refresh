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
import { config } from '../../server/config/index.js';
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
  const cred = await req('POST', '/credentials', {
    cookie, body: { name: `${PROJ}-ps-cred`, engine: 'sqlserver', username: 'sqlserver', secretKind: 'ref', secretRef: 'env:ITEST_NOPE' },
  });
  assert.equal(cred.status, 201);
  const inst = await req('POST', '/instances', {
    cookie,
    body: {
      projectRef: proj.data.id, instanceName: 'itest-mssql', engine: 'sqlserver',
      dbHost: '10.0.0.1', credentialRef: cred.data.id,
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
    await req('DELETE', `/credentials/${cred.data.id}`, { cookie });
    await req('DELETE', `/projects/${proj.data.id}`, { cookie });
  }
});

test('instancias sin conexión SQL (solo restore) y buckets con ruta gs:// pegada', async (t) => {
  if (!dbOk) return t.skip('BD no disponible');
  const { cookie } = await login(ADMIN, PW);
  const proj = await req('POST', '/projects', { cookie, body: { projectId: `${PROJ}-nc` } });
  const ids = { inst: null, bucket: null, cred: null };
  try {
    const projectRef = proj.data.id;
    const cred = await req('POST', '/credentials', {
      cookie, body: { name: `${PROJ}-nc-cred`, engine: 'sqlserver', username: 'sqlserver', password: 'ItestPw-123' },
    });
    ids.cred = cred.data.id;
    // Sin host/credencial: válida (el import va por el Admin API).
    const inst = await req('POST', '/instances', {
      cookie, body: { projectRef, instanceName: 'itest-nocreds', engine: 'sqlserver' },
    });
    assert.equal(inst.status, 201);
    ids.inst = inst.data.id;
    assert.equal(inst.data.db_host, null);
    assert.equal(inst.data.credential_ref, null);

    // Credencial sin host o de otro motor: rechazadas.
    const partial = { projectRef, instanceName: 'itest-partial', engine: 'sqlserver', credentialRef: ids.cred };
    assert.equal((await req('POST', '/instances', { cookie, body: partial })).status, 422);
    const otherEngine = { ...partial, engine: 'postgres', dbHost: '10.0.0.1' };
    assert.equal((await req('POST', '/instances', { cookie, body: otherEngine })).status, 422);

    // Post-script activo sin conexión SQL: 422; inactivo: permitido.
    const ps = `/instances/${ids.inst}/post-scripts`;
    const script = { name: 'job', sqlText: 'SELECT 1' };
    assert.equal((await req('POST', ps, { cookie, body: script })).status, 422);
    const inactive = await req('POST', ps, { cookie, body: { ...script, isActive: false } });
    assert.equal(inactive.status, 201);

    // Con conexión completa se puede activar; quitarla con scripts activos: 422.
    const creds = { projectRef, instanceName: 'itest-nocreds', engine: 'sqlserver',
      dbHost: '10.0.0.1', credentialRef: ids.cred };
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
    if (ids.cred) await req('DELETE', `/credentials/${ids.cred}`, { cookie });
    if (ids.bucket) await req('DELETE', `/buckets/${ids.bucket}`, { cookie });
    await req('DELETE', `/projects/${proj.data.id}`, { cookie });
  }
});

test('restore: validación de owner/BD de sistema y RBAC de BDs/usuarios en vivo', async (t) => {
  if (!dbOk) return t.skip('BD no disponible');
  const { cookie } = await login(ADMIN, PW);
  const proj = await req('POST', '/projects', { cookie, body: { projectId: `${PROJ}-own` } });
  let instId = null;
  try {
    const inst = await req('POST', '/instances', {
      cookie, body: { projectRef: proj.data.id, instanceName: 'itest-owner', engine: 'sqlserver' },
    });
    instId = inst.data.id;
    const launch = (mapping) =>
      req('POST', '/restores', { cookie, body: { instanceId: instId, bucketPath: 'gs://itest-b/x', mapping } });
    // Inválidos: no se encola nada.
    assert.equal((await launch([{ backupFile: 'a.bak', targetDb: 'ventas', importUser: 'sa' }])).status, 422);
    assert.equal((await launch([{ backupFile: 'a.bak', targetDb: 'master' }])).status, 422);
    // Restore nativo: solo PostgreSQL (esta instancia es SQL Server).
    const native = await req('POST', '/restores', {
      cookie, body: { instanceId: instId, bucketPath: 'gs://itest-b/x', method: 'native', mapping: [{ backupFile: 'a.tar', targetDb: 'ventas' }] },
    });
    assert.equal(native.status, 422);
    // Corrección de huérfanos sin conexión SQL en la instancia: 422 (no se encola).
    assert.equal((await launch([{ backupFile: 'a.bak', targetDb: 'ventas', fixOrphans: true }])).status, 422);
    const logins = await req('GET', `/instances/${instId}/logins`, { cookie });
    assert.equal(logins.status, 200);
    assert.equal(logins.data.supported, true);
    assert.match(logins.data.reason, /conexión SQL/);

    const viewer = await login(VIEWER, PW);
    assert.equal((await req('GET', `/instances/${instId}/databases`, { cookie: viewer.cookie })).status, 403);
    assert.equal((await req('GET', `/instances/${instId}/users`, { cookie: viewer.cookie })).status, 403);
    // SQL Server: el owner no aplica -> no consulta GCP.
    const users = await req('GET', `/instances/${instId}/users`, { cookie });
    assert.equal(users.status, 200);
    assert.deepEqual(users.data, { supported: false, users: [] });
  } finally {
    if (instId) await req('DELETE', `/instances/${instId}`, { cookie });
    await req('DELETE', `/projects/${proj.data.id}`, { cookie });
  }
});

test('credenciales SQL (admin): CRUD sin exponer la contraseña, en uso 409 y RBAC', async (t) => {
  if (!dbOk) return t.skip('BD no disponible');
  const { cookie } = await login(ADMIN, PW);
  const ids = { cred: null, inst: null, proj: null };
  try {
    const created = await req('POST', '/credentials', {
      cookie, body: { name: `${PROJ}-cred`, engine: 'postgres', username: 'postgres', password: 'Sup3r-Secreta' },
    });
    assert.equal(created.status, 201);
    ids.cred = created.data.id;
    assert.equal(created.data.has_password, true);
    assert.equal(JSON.stringify(created.data).includes('Sup3r-Secreta'), false);
    assert.equal('password_enc' in created.data, false);

    // Duplicado 409; sin password 422; listado sin secreto.
    assert.equal((await req('POST', '/credentials', { cookie, body: { name: `${PROJ}-cred`, engine: 'postgres', username: 'x', password: 'y' } })).status, 409);
    assert.equal((await req('POST', '/credentials', { cookie, body: { name: `${PROJ}-cred2`, engine: 'postgres', username: 'x' } })).status, 422);
    const list = await req('GET', '/credentials', { cookie });
    assert.equal(JSON.stringify(list.data).includes('Sup3r-Secreta'), false);

    // Editar sin password conserva la guardada.
    const upd = await req('PUT', `/credentials/${ids.cred}`, { cookie, body: { name: `${PROJ}-cred`, engine: 'postgres', username: 'app_admin' } });
    assert.equal(upd.status, 200);
    assert.equal(upd.data.username, 'app_admin');
    assert.equal(upd.data.has_password, true);

    // En uso por una instancia: no se puede borrar ni cambiar de motor.
    const proj = await req('POST', '/projects', { cookie, body: { projectId: `${PROJ}-cr` } });
    ids.proj = proj.data.id;
    const inst = await req('POST', '/instances', {
      cookie, body: { projectRef: ids.proj, instanceName: 'itest-pg', engine: 'postgres', dbHost: '10.0.0.9', credentialRef: ids.cred },
    });
    assert.equal(inst.status, 201);
    ids.inst = inst.data.id;
    assert.equal(inst.data.credential_name, `${PROJ}-cred`);
    assert.equal((await req('DELETE', `/credentials/${ids.cred}`, { cookie })).status, 409);
    assert.equal((await req('PUT', `/credentials/${ids.cred}`, { cookie, body: { name: `${PROJ}-cred`, engine: 'mysql', username: 'x' } })).status, 422);

    // Probar conexión: host obligatorio; con host inalcanzable responde ok:false (no 500).
    assert.equal((await req('POST', `/credentials/${ids.cred}/test`, { cookie, body: {} })).status, 422);

    // RBAC: un viewer no ve credenciales.
    const viewer = await login(VIEWER, PW);
    assert.equal((await req('GET', '/credentials', { cookie: viewer.cookie })).status, 403);
    assert.equal((await req('POST', `/instances/${ids.inst}/test-connection`, { cookie: viewer.cookie })).status, 403);
  } finally {
    if (ids.inst) await req('DELETE', `/instances/${ids.inst}`, { cookie });
    if (ids.cred) await req('DELETE', `/credentials/${ids.cred}`, { cookie });
    if (ids.proj) await req('DELETE', `/projects/${ids.proj}`, { cookie });
  }
});

test('post-scripts: "Ejecutar" ahora devuelve la salida (NOTICE y tablas) y exige conexión SQL', async (t) => {
  if (!dbOk) return t.skip('BD no disponible');
  const { cookie } = await login(ADMIN, PW);
  const ids = { proj: null, cred: null, inst: null, bare: null };
  try {
    const proj = await req('POST', '/projects', { cookie, body: { projectId: `${PROJ}-run` } });
    ids.proj = proj.data.id;
    // Instancia "PostgreSQL" que apunta al PostgreSQL local de la app (ejecución real).
    const cred = await req('POST', '/credentials', {
      cookie, body: { name: `${PROJ}-run-cred`, engine: 'postgres', username: config.db.user, password: config.db.password },
    });
    ids.cred = cred.data.id;
    const inst = await req('POST', '/instances', {
      cookie, body: { projectRef: ids.proj, instanceName: 'itest-run-pg', engine: 'postgres', dbHost: config.db.host, dbPort: config.db.port, credentialRef: ids.cred },
    });
    ids.inst = inst.data.id;
    const script = await req('POST', `/instances/${ids.inst}/post-scripts`, {
      cookie, body: { name: 'reporte', databaseName: config.db.database, isActive: false,
        sqlText: "DO $$ BEGIN RAISE NOTICE 'hola desde el script'; END $$; SELECT 'SolPago' AS basedatos, 'ERROR' AS estado;" },
    });
    assert.equal(script.status, 201);

    const run = await req('POST', `/instances/${ids.inst}/post-scripts/${script.data.id}/run`, { cookie, body: {} });
    assert.equal(run.status, 200);
    assert.equal(run.data.ok, true);
    const text = run.data.lines.map((l) => `${l.level}:${l.message}`).join(' | ');
    assert.match(text, /hola desde el script/);
    assert.match(text, /basedatos\s+estado/);
    assert.ok(run.data.lines.some((l) => l.level === 'warning' && /SolPago\s+ERROR/.test(l.message)));

    // Un script que falla devuelve ok:false con el error (no 500).
    const bad = await req('POST', `/instances/${ids.inst}/post-scripts`, {
      cookie, body: { name: 'roto', databaseName: config.db.database, isActive: false, sqlText: 'SELECT * FROM tabla_que_no_existe_itest' },
    });
    const runBad = await req('POST', `/instances/${ids.inst}/post-scripts/${bad.data.id}/run`, { cookie, body: {} });
    assert.equal(runBad.status, 200);
    assert.equal(runBad.data.ok, false);
    assert.match(runBad.data.error, /tabla_que_no_existe_itest/);

    // Sin conexión SQL: 422. Viewer: 403.
    const bare = await req('POST', '/instances', { cookie, body: { projectRef: ids.proj, instanceName: 'itest-run-bare', engine: 'postgres' } });
    ids.bare = bare.data.id;
    const s2 = await req('POST', `/instances/${ids.bare}/post-scripts`, { cookie, body: { name: 'x', isActive: false, sqlText: 'SELECT 1' } });
    assert.equal((await req('POST', `/instances/${ids.bare}/post-scripts/${s2.data.id}/run`, { cookie, body: {} })).status, 422);
    const viewer = await login(VIEWER, PW);
    assert.equal((await req('POST', `/instances/${ids.inst}/post-scripts/${script.data.id}/run`, { cookie: viewer.cookie, body: {} })).status, 403);
  } finally {
    for (const id of [ids.inst, ids.bare]) if (id) await req('DELETE', `/instances/${id}`, { cookie });
    if (ids.cred) await req('DELETE', `/credentials/${ids.cred}`, { cookie });
    if (ids.proj) await req('DELETE', `/projects/${ids.proj}`, { cookie });
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
