// Parte un script T-SQL en lotes por el separador `GO` (línea sola, sin
// distinguir mayúsculas), igual que sqlcmd / split_sql_batches del script
// original. `GO` no es T-SQL: el servidor no lo entiende, lo resuelve el cliente.
// No soporta `GO <n>` (repetición) a propósito: se trata como texto normal.
export function splitSqlBatches(sqlText) {
  return String(sqlText ?? '')
    .replace(/^﻿/, '')
    .split(/^[ \t]*GO[ \t]*;?[ \t]*\r?$/gim) // \r?: scripts con fin de línea CRLF
    .map((b) => b.trim())
    .filter(Boolean);
}
