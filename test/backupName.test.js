import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripBackupExt, suggestDbName } from '../web/src/lib/backupName.js';

test('stripBackupExt: quita la extensión completa, también .sql.gz', () => {
  assert.equal(stripBackupExt('PaynovaBD_PRD_20261002_201635.sql.gz'), 'PaynovaBD_PRD_20261002_201635');
  assert.equal(stripBackupExt('ventas.sql'), 'ventas');
  assert.equal(stripBackupExt('ventas.bak'), 'ventas');
  assert.equal(stripBackupExt('app.tar'), 'app');
  assert.equal(stripBackupExt('app.gz'), 'app');
});

test('suggestDbName: formato de db-keeper {BD}_{AMBIENTE}_{AAAAMMDD}_{HHMMSS}', () => {
  assert.equal(suggestDbName('PaynovaBD_PRD_20261002_201635.sql.gz'), 'PaynovaBD');
  assert.equal(suggestDbName('PaynovaBD_PRD_20261005_162344.sql'), 'PaynovaBD');
  assert.equal(suggestDbName('QSPMS_INTERSEGURO_PRD_20261002.bak'), 'QSPMS_INTERSEGURO');
  assert.equal(suggestDbName('ventas_qa_20261002_101010.bak'), 'ventas');
});

test('suggestDbName: sin ambiente, o con un sufijo que no es ambiente, no recorta el nombre', () => {
  assert.equal(suggestDbName('QSPMS_INTERSEGURO_20261002_101010.bak'), 'QSPMS_INTERSEGURO');
  assert.equal(suggestDbName('app_v2_20261002_101010.sql.gz'), 'app_v2');
});

test('suggestDbName: nombres sin marca de tiempo quedan solo sin extensión', () => {
  assert.equal(suggestDbName('ventas.bak'), 'ventas');
  assert.equal(suggestDbName('backup_PaynovaBD.sql'), 'backup_PaynovaBD');
  assert.equal(suggestDbName('PRD_20261002_101010.sql'), 'PRD'); // nunca deja el nombre vacío
});
