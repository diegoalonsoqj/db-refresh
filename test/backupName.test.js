import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripBackupExt, suggestDbName } from '../web/src/lib/backupName.js';

test('stripBackupExt: quita la extensión completa, también .sql.gz', () => {
  assert.equal(stripBackupExt('VentasBD_PRD_20261002_201635.sql.gz'), 'VentasBD_PRD_20261002_201635');
  assert.equal(stripBackupExt('ventas.sql'), 'ventas');
  assert.equal(stripBackupExt('ventas.bak'), 'ventas');
  assert.equal(stripBackupExt('app.tar'), 'app');
  assert.equal(stripBackupExt('app.gz'), 'app');
});

test('suggestDbName: formato de db-keeper {BD}_{AMBIENTE}_{AAAAMMDD}_{HHMMSS}', () => {
  assert.equal(suggestDbName('VentasBD_PRD_20261002_201635.sql.gz'), 'VentasBD');
  assert.equal(suggestDbName('VentasBD_PRD_20261005_162344.sql'), 'VentasBD');
  assert.equal(suggestDbName('VENTAS_CORE_PRD_20261002.bak'), 'VENTAS_CORE');
  assert.equal(suggestDbName('ventas_qa_20261002_101010.bak'), 'ventas');
});

test('suggestDbName: sin ambiente, o con un sufijo que no es ambiente, no recorta el nombre', () => {
  assert.equal(suggestDbName('VENTAS_CORE_20261002_101010.bak'), 'VENTAS_CORE');
  assert.equal(suggestDbName('app_v2_20261002_101010.sql.gz'), 'app_v2');
});

test('suggestDbName: nombres sin marca de tiempo quedan solo sin extensión', () => {
  assert.equal(suggestDbName('ventas.bak'), 'ventas');
  assert.equal(suggestDbName('backup_VentasBD.sql'), 'backup_VentasBD');
  assert.equal(suggestDbName('PRD_20261002_101010.sql'), 'PRD'); // nunca deja el nombre vacío
});
