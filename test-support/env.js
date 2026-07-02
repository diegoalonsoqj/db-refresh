// Fija variables de entorno mínimas para importar `config` en los tests, con
// valores AISLADOS (no secretos reales). Se importa PRIMERO en cada test que
// cargue la cadena de config; en ESM los imports se evalúan en orden, así que
// estas asignaciones corren antes de que `config` lea process.env.
// `??=` no pisa valores ya presentes (p.ej. en CI).
process.env.NODE_ENV ??= 'test';
process.env.APP_DB_PASSWORD ??= 'test-db-pass';
process.env.JWT_SECRET ??= 'test-jwt-secret-solo-para-tests';
process.env.APP_ENCRYPTION_KEY ??= 'test-encryption-key-solo-para-tests';
