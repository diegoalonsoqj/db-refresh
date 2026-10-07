import '../test-support/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  afterRun, buildSchedule, globToRegExp, instantToWallClock, nextRunForCron, pickLatest,
  resolveTaskMapping, suggestPattern, validateTaskMapping, zonedWallClockToInstant,
} from '../server/domain/restoreTask.js';
import { ValidationError } from '../server/domain/errors.js';

const LIMA = 'America/Lima'; // UTC-5, sin horario de verano

test('globToRegExp: * es cualquier secuencia, el resto es literal y la coincidencia es completa', () => {
  const re = globToRegExp('PaynovaBD_PRD_*.sql.gz');
  assert.ok(re.test('PaynovaBD_PRD_20261002_201635.sql.gz'));
  assert.ok(!re.test('PaynovaBD_PRD_20261002_201635.sql'));       // extensión distinta
  assert.ok(!re.test('X_PaynovaBD_PRD_1.sql.gz'));                   // no es prefijo
  assert.ok(!globToRegExp('a.sql').test('aXsql'));                   // el punto es literal
});

test('pickLatest: el más reciente por fecha de GCS y, a igualdad, por nombre', () => {
  const files = [
    { fileName: 'PaynovaBD_PRD_20261002_201635.sql.gz', updated: '2026-10-02T20:16:40Z' },
    { fileName: 'PaynovaBD_PRD_20261005_162344.sql.gz', updated: '2026-10-05T16:23:50Z' },
    { fileName: 'PaynovaBD_PRD_20261005_141622.sql.gz', updated: '2026-10-05T14:16:30Z' },
    { fileName: 'OtraBD_PRD_20261007_010101.sql.gz', updated: '2026-10-07T01:01:05Z' },
  ];
  assert.equal(pickLatest(files, 'PaynovaBD_PRD_*.sql.gz').fileName, 'PaynovaBD_PRD_20261005_162344.sql.gz');
  assert.equal(pickLatest(files, 'NoExiste_*'), null);
  const noDates = [{ fileName: 'a_20261001.bak' }, { fileName: 'a_20261003.bak' }];
  assert.equal(pickLatest(noDates, 'a_*.bak').fileName, 'a_20261003.bak');
});

test('suggestPattern: las fechas/horas pasan a un único *', () => {
  assert.equal(suggestPattern('PaynovaBD_PRD_20261002_201635.sql.gz'), 'PaynovaBD_PRD_*.sql.gz');
  assert.equal(suggestPattern('QSPMS_INTERSEGURO_PRD_20261002.bak'), 'QSPMS_INTERSEGURO_PRD_*.bak');
  assert.equal(suggestPattern('ventas.bak'), 'ventas.bak');
});

test('validateTaskMapping: archivo fijo o patrón, con las reglas de un restore', () => {
  const rows = validateTaskMapping('postgres', [
    { source: 'latest', pattern: ' PaynovaBD_PRD_*.sql.gz ', targetDb: 'PaynovaBD', importUser: 'UserPaynova', dropViaSql: true },
    { backupFile: 'fijo.sql', targetDb: 'otra' }, // sin source = fijo (programadas anteriores)
  ]);
  assert.equal(rows[0].source, 'latest');
  assert.equal(rows[0].pattern, 'PaynovaBD_PRD_*.sql.gz');
  assert.equal(rows[0].backupFile, null);
  assert.equal(rows[0].importUser, 'UserPaynova');
  assert.equal(rows[0].dropViaSql, true);
  assert.deepEqual([rows[1].source, rows[1].backupFile, rows[1].pattern], ['fixed', 'fijo.sql', null]);

  assert.throws(() => validateTaskMapping('postgres', [{ source: 'latest', pattern: '../x*', targetDb: 'a' }]), ValidationError);
  assert.throws(() => validateTaskMapping('postgres', [{ source: 'latest', pattern: '', targetDb: 'a' }]), ValidationError);
  assert.throws(() => validateTaskMapping('postgres', [{ source: 'otro', backupFile: 'a.sql', targetDb: 'a' }]), ValidationError);
  // Las reglas comunes siguen aplicando: BD de sistema y destino repetido.
  assert.throws(() => validateTaskMapping('postgres', [{ source: 'latest', pattern: 'a_*.sql', targetDb: 'postgres' }]), ValidationError);
  assert.throws(() => validateTaskMapping('postgres', [
    { source: 'latest', pattern: 'a_*.sql', targetDb: 'app' }, { backupFile: 'b.sql', targetDb: 'APP' },
  ]), ValidationError);
});

test('resolveTaskMapping: el patrón toma el último backup; si no hay ninguno, falla sin lanzar', () => {
  const files = [
    { fileName: 'app_20261001_010101.sql.gz', updated: '2026-10-01T01:01:01Z' },
    { fileName: 'app_20261006_010101.sql.gz', updated: '2026-10-06T01:01:01Z' },
  ];
  const mapping = [
    { source: 'latest', pattern: 'app_*.sql.gz', backupFile: null, targetDb: 'app', importUser: null },
    { source: 'fixed', pattern: null, backupFile: 'fijo.sql', targetDb: 'otra', importUser: null },
  ];
  assert.deepEqual(resolveTaskMapping(mapping, files), [
    { backupFile: 'app_20261006_010101.sql.gz', targetDb: 'app', importUser: null },
    { backupFile: 'fijo.sql', targetDb: 'otra', importUser: null },
  ]);
  assert.throws(() => resolveTaskMapping(mapping, []), /app_\*\.sql\.gz/);
});

test('zonedWallClockToInstant / instantToWallClock: hora de pared en la zona de la tarea', () => {
  const at = zonedWallClockToInstant('2026-10-10T21:00', LIMA);
  assert.equal(at.toISOString(), '2026-10-11T02:00:00.000Z');
  assert.equal(instantToWallClock(at, LIMA), '2026-10-10T21:00');
  assert.throws(() => zonedWallClockToInstant('10/10/2026 21:00', LIMA), ValidationError);
});

test('nextRunForCron: siguiente ejecución en la zona horaria', () => {
  const from = new Date('2026-10-07T12:00:00Z'); // 07:00 en Lima
  assert.equal(nextRunForCron('0 21 * * *', LIMA, from).toISOString(), '2026-10-08T02:00:00.000Z');
  assert.throws(() => nextRunForCron('no es cron', LIMA, from), ValidationError);
});

test('buildSchedule: sin programar, una vez (futura) y recurrente', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  assert.deepEqual(buildSchedule({ mode: 'none' }, now, LIMA),
    { mode: 'none', cronExpr: null, runAt: null, timezone: LIMA, nextRunAt: null, isActive: false });

  const once = buildSchedule({ mode: 'once', runAt: '2026-10-10T21:00' }, now, LIMA);
  assert.equal(once.nextRunAt.toISOString(), '2026-10-11T02:00:00.000Z');
  assert.equal(once.isActive, true);
  assert.throws(() => buildSchedule({ mode: 'once', runAt: '2026-10-01T21:00' }, now, LIMA), /ya pasaron/);

  const rec = buildSchedule({ mode: 'recurring', cron: '30 2 * * 1', timezone: 'UTC' }, now, LIMA);
  assert.equal(rec.timezone, 'UTC');
  assert.equal(rec.nextRunAt.toISOString(), '2026-10-12T02:30:00.000Z'); // lunes 02:30 UTC

  assert.throws(() => buildSchedule({ mode: 'recurring', cron: '' }, now, LIMA), ValidationError);
  assert.throws(() => buildSchedule({ mode: 'once', runAt: '2026-10-10T21:00', timezone: 'Marte/Base' }, now, LIMA), /Zona horaria/);
  assert.throws(() => buildSchedule({ mode: 'cada-tanto' }, now, LIMA), ValidationError);
});

test('afterRun: una vez se desactiva; recurrente calcula la siguiente; cron roto se desactiva', () => {
  const now = new Date('2026-10-08T02:00:30Z');
  assert.deepEqual(afterRun({ schedule_mode: 'once' }, now), { nextRunAt: null, isActive: false });
  const rec = afterRun({ schedule_mode: 'recurring', cron_expr: '0 21 * * *', timezone: LIMA }, now);
  assert.equal(rec.nextRunAt.toISOString(), '2026-10-09T02:00:00.000Z');
  assert.equal(rec.isActive, true);
  assert.deepEqual(afterRun({ schedule_mode: 'recurring', cron_expr: 'x', timezone: LIMA }, now), { nextRunAt: null, isActive: false });
});

test('validateTaskMapping: método nativo admite alcance por esquema y formatos .tar/.sql; import no', () => {
  const rows = validateTaskMapping('postgres', [
    { source: 'latest', pattern: 'app_*.tar', targetDb: 'app', scope: 'schema', schemaName: 'ventas' },
  ], 'native');
  assert.equal(rows[0].scope, 'schema');
  assert.equal(rows[0].schemaName, 'ventas');
  assert.equal(rows[0].pattern, 'app_*.tar');
  // Por esquema solo con el nativo; el nativo no lee .bak; el nativo solo en PostgreSQL.
  assert.throws(() => validateTaskMapping('postgres', [{ source: 'latest', pattern: 'app_*.tar', targetDb: 'app', scope: 'schema', schemaName: 'v' }]), ValidationError);
  assert.throws(() => validateTaskMapping('postgres', [{ source: 'fixed', backupFile: 'a.bak', targetDb: 'app' }], 'native'), ValidationError);
  assert.throws(() => validateTaskMapping('sqlserver', [{ source: 'fixed', backupFile: 'a.bak', targetDb: 'app' }], 'native'), ValidationError);
});
