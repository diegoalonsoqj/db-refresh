import '../test-support/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatResultSet } from '../server/lib/resultSets.js';

test('formatResultSet: tabla alineada con cabecera y separador', () => {
  const lines = formatResultSet([{ BaseDatos: 'SolPago', Estado: 'OK' }, { BaseDatos: 'IFRS17', Estado: 'PENDIENTE' }]);
  assert.deepEqual(lines.map(([, t]) => t), [
    'BaseDatos  Estado',
    '---------  ---------',
    'SolPago    OK',
    'IFRS17     PENDIENTE',
  ]);
  assert.ok(lines.every(([lvl]) => lvl === 'info'));
});

test('formatResultSet: filas con ERROR como aviso; NULL, fechas y textos largos', () => {
  const lines = formatResultSet([
    { db: 'A', estado: 'ERROR', detalle: null },
    { db: 'B', estado: 'OK', detalle: 'x'.repeat(200) },
  ], ['db', 'estado', 'detalle']);
  assert.equal(lines[2][0], 'warning');
  assert.match(lines[2][1], /NULL$/);
  assert.equal(lines[3][0], 'info');
  assert.ok(lines[3][1].endsWith('…'));
  assert.ok(lines[3][1].length < 120);
});

test('formatResultSet: sin filas y sin columnas', () => {
  assert.deepEqual(formatResultSet([], ['a', 'b']), [['info', '(sin filas) a | b']]);
  assert.deepEqual(formatResultSet([]), []);
});

test('formatResultSet: limita las filas volcadas', () => {
  const rows = Array.from({ length: 205 }, (_, i) => ({ n: i }));
  const lines = formatResultSet(rows);
  assert.equal(lines.length, 2 + 200 + 1);
  assert.match(lines.at(-1)[1], /5 fila\(s\) más omitidas/);
});
