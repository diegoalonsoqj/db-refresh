// Nombre de BD sugerido a partir del nombre de un backup. Los genera db-keeper
// como `{BD}_{AMBIENTE}_{AAAAMMDD}_{HHMMSS}.{ext}` (ambiente opcional):
//   PaynovaBD_PRD_20261002_201635.sql.gz -> PaynovaBD
// Sin JSX ni dependencias: lo usan Lanzar restore y los tests (node --test).

// Extensiones de backup (la más larga primero: .sql.gz antes que .gz).
const EXT_RE = /\.(sql\.gz|sql|gz|bak|tar)$/i;
// Marca de tiempo final: _AAAAMMDD_HHMMSS o solo _AAAAMMDD.
const STAMP_RE = /_\d{8}(?:_\d{6})?$/;
// Códigos de ambiente habituales. Solo se quitan estos: un sufijo cualquiera en
// mayúsculas puede ser parte del nombre (QSPMS_INTERSEGURO).
const ENV_CODES = ['PRD', 'PROD', 'QA', 'UAT', 'DEV', 'DESA', 'HML', 'HOMO', 'STG', 'TEST', 'CERT', 'PRE', 'SANDBOX'];
const ENV_RE = new RegExp(`_(?:${ENV_CODES.join('|')})$`, 'i');

/** Nombre del archivo sin su extensión de backup (`X.sql.gz` -> `X`). */
export function stripBackupExt(fileName) {
  return String(fileName ?? '').replace(EXT_RE, '');
}

/**
 * BD sugerida para un backup: sin extensión, sin la marca de tiempo y, si la
 * había, sin el código de ambiente. Si el nombre no sigue ese formato, se
 * devuelve sin la extensión.
 */
export function suggestDbName(fileName) {
  const stem = stripBackupExt(fileName);
  if (!STAMP_RE.test(stem)) return stem;
  const noStamp = stem.replace(STAMP_RE, '');
  const noEnv = noStamp.replace(ENV_RE, '');
  return noEnv || noStamp || stem;
}
