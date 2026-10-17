import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PAGE_SIZE, SqlWhere, escapeLike, orderBy, parseListQuery } from '../server/lib/listQuery.js';
import { ValidationError } from '../server/domain/errors.js';

const spec = { sorts: ['name', 'created'], filters: { status: ['ok', 'failed'], from: 'date', active: 'bool', user: 'text' } };

test('parseListQuery: valores por defecto y vacíos = sin filtro', () => {
  const r = parseListQuery({ q: '  ', status: '', user: ' ' }, spec);
  assert.deepEqual(r, { limit: DEFAULT_PAGE_SIZE, offset: 0, q: undefined, sort: undefined, dir: undefined, filters: {} });
});

test('parseListQuery: convierte tipos de filtro', () => {
  const r = parseListQuery({ limit: '50', offset: '100', q: ' paynova ', sort: 'created', dir: 'desc',
    status: 'failed', from: '2026-10-01T05:00:00.000Z', active: 'false', user: 'ana' }, spec);
  assert.equal(r.limit, 50);
  assert.equal(r.offset, 100);
  assert.equal(r.q, 'paynova');
  assert.equal(r.filters.status, 'failed');
  assert.ok(r.filters.from instanceof Date);
  assert.equal(r.filters.active, false);
  assert.equal(r.filters.user, 'ana');
});

test('parseListQuery: rechaza orden, sentido, límites y valores no permitidos', () => {
  for (const bad of [{ sort: 'password_hash' }, { dir: 'up' }, { limit: '0' }, { limit: '101' }, { offset: '-1' },
    { limit: '1.5' }, { status: 'x' }, { from: 'ayer' }, { active: 'si' }, { q: 'x'.repeat(101) }, { q: ['a', 'b'] }]) {
    assert.throws(() => parseListQuery(bad, spec), ValidationError, JSON.stringify(bad));
  }
});

test('escapeLike: escapa comodines', () => {
  assert.equal(escapeLike('50%_a\\b'), '50\\%\\_a\\\\b');
});

test('SqlWhere: placeholders numerados y búsqueda en varias columnas', () => {
  const w = new SqlWhere().search(['a', 'b'], 'x_y').eq('c', 'v').eq('d', '').dateRange('t', new Date(0), new Date(0));
  assert.equal(w.sql, "WHERE (a ILIKE $1 OR b ILIKE $1) AND c = $2 AND t >= $3 AND t < $4::timestamptz + interval '1 day'");
  assert.equal(w.params[0], '%x\\_y%');
  assert.equal(w.params.length, 4);
  assert.equal(new SqlWhere().sql, '');
});

test('orderBy: clave permitida, sentido por defecto y desempate', () => {
  const cols = { name: 'lower(n)', created: 'c' };
  assert.equal(orderBy(cols, undefined, undefined, { sort: 'created', dir: 'desc' }, 'id'), 'ORDER BY c DESC NULLS LAST, id');
  assert.equal(orderBy(cols, 'name', undefined, { sort: 'created', dir: 'desc' }, 'id'), 'ORDER BY lower(n) ASC NULLS LAST, id');
  assert.equal(orderBy(cols, 'name', 'desc', { sort: 'created', dir: 'desc' }, 'id'), 'ORDER BY lower(n) DESC NULLS LAST, id');
});
