// Herramientas nativas de PostgreSQL (pg_restore / psql) ejecutadas en este
// servidor contra la IP privada de la instancia. Sin shell (spawn con argumentos)
// y con la contraseña solo en el entorno del proceso hijo (PGPASSWORD), nunca en
// los argumentos ni en los logs. El dump entra por stdin en streaming.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { DomainError, InfraError, JobCancelledError } from '../../domain/errors.js';
import { config } from '../../config/index.js';

const EXE = process.platform === 'win32' ? '.exe' : '';

/** Ruta del binario (PG_BIN_DIR o el PATH). */
export function toolPath(name) {
  const dir = config.nativeRestore.binDir;
  return dir ? join(dir, `${name}${EXE}`) : name;
}

/** Cita un identificador de PostgreSQL ("a""b"). */
export const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

/** Entorno de conexión libpq del proceso hijo (la contraseña no va en argumentos). */
export function pgEnv(conn) {
  return {
    ...process.env,
    PGHOST: conn.host,
    PGPORT: String(conn.port),
    PGUSER: conn.user,
    PGPASSWORD: conn.password,
    PGSSLMODE: 'prefer', // TLS si el servidor lo ofrece (Cloud SQL), sin él si no
    PGAPPNAME: 'db-refresh',
    PGCONNECT_TIMEOUT: '15',
  };
}

/**
 * Argumentos de pg_restore (dump tar por stdin). --no-owner/--no-privileges: en
 * Cloud SQL el usuario no es superusuario y los ALTER OWNER/GRANT a roles de
 * origen fallarían; con `role` los objetos quedan a nombre de ese rol (SET ROLE).
 */
export function buildPgRestoreArgs({ database, schemaName = null, role = null }) {
  return [
    '--no-owner', '--no-privileges', '--exit-on-error',
    '--dbname', database,
    ...(role ? ['--role', role] : []),
    ...(schemaName ? ['--schema', schemaName] : []),
  ];
}

/** Argumentos de psql (dump plano por stdin); se detiene en el primer error. */
export function buildPsqlArgs({ database, role = null }) {
  return [
    '--no-psqlrc', '--quiet', '--set', 'ON_ERROR_STOP=1',
    '--dbname', database,
    ...(role ? ['--command', `SET ROLE ${quoteIdent(role)}`] : []),
    '--file', '-',
  ];
}

// Tipos de objeto del índice de pg_restore -l cuya segunda columna es el esquema.
const TOC_NAMESPACED = /^\d+; \d+ \d+ (?:TABLE DATA|TABLE|VIEW|MATERIALIZED VIEW|SEQUENCE|FUNCTION|PROCEDURE|AGGREGATE|TYPE|DOMAIN|INDEX|CONSTRAINT|FK CONSTRAINT|TRIGGER|DEFAULT) (\S+) /;
const TOC_SCHEMA = /^\d+; \d+ \d+ SCHEMA - (\S+) /;

/** Esquemas presentes en la salida de `pg_restore -l` (función pura). */
export function parseTocSchemas(text) {
  const schemas = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const m = TOC_SCHEMA.exec(line) ?? TOC_NAMESPACED.exec(line);
    if (m && m[1] !== '-') schemas.add(m[1]);
  }
  return [...schemas].sort((a, b) => a.localeCompare(b));
}

/** Versión mayor de una herramienta (pg_restore --version -> 17). Lanza si no está instalada. */
export async function toolVersion(name) {
  const { code, stdout } = await runTool({ cmd: toolPath(name), args: ['--version'], timeoutMs: 15_000 });
  const m = /(\d+)(?:\.\d+)?/.exec(stdout);
  if (code !== 0 || !m) throw new InfraError(`${name} --version falló: ${stdout.trim()}`, { code: 'NATIVE_TOOLS_MISSING' });
  return { major: Number(m[1]), text: stdout.trim() };
}

/**
 * Ejecuta un binario. `input` (Readable) se canaliza a stdin. `onLine` recibe
 * cada línea de stderr/stdout (hasta `maxLines`; el resto solo cuenta).
 * Nunca usa shell. Resuelve { code, stdout, tail } (tail = últimas líneas).
 * Con `signal` (cancelación del job) mata el proceso y rechaza con JobCancelledError.
 */
export function runTool({ cmd, args, env = process.env, input = null, onLine = null, timeoutMs, maxLines = 200, keepStdout = true, signal = null }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { env, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    const tail = [];
    let emitted = 0;
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = () => {
      child.kill('SIGKILL');
      input?.destroy();
      finish(() => reject(new JobCancelledError(`${cmd} detenido: cancelado por el usuario`)));
    };

    const handleChunk = (buf, isStdout) => {
      const text = buf.toString('utf8');
      if (isStdout && keepStdout) stdout += text;
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        tail.push(line);
        if (tail.length > 20) tail.shift();
        if (onLine && emitted < maxLines) onLine(line);
        emitted += 1;
      }
    };
    child.stdout.on('data', (b) => handleChunk(b, true));
    child.stderr.on('data', (b) => handleChunk(b, false));

    const timer = timeoutMs
      ? setTimeout(() => {
        child.kill('SIGKILL');
        finish(() => reject(new InfraError(`${cmd} superó el tiempo máximo (${Math.round(timeoutMs / 1000)}s)`, { code: 'NATIVE_TIMEOUT' })));
      }, timeoutMs)
      : null;

    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (err) => {
      const missing = err.code === 'ENOENT';
      finish(() => reject(missing
        ? new DomainError(`No se encontró ${cmd}: instala postgresql-client en el servidor o configura PG_BIN_DIR`, { code: 'NATIVE_TOOLS_MISSING' })
        : err));
    });
    child.on('close', (code) => finish(() => resolve({ code, stdout, tail, linesOmitted: Math.max(0, emitted - maxLines) })));

    if (input) {
      // El hijo puede cerrar stdin antes de leerlo todo (p.ej. pg_restore -l o un error):
      // EPIPE no es un fallo en sí; el código de salida decide.
      child.stdin.on('error', () => {});
      input.on('error', (err) => {
        child.kill('SIGKILL');
        finish(() => reject(new InfraError(`Error leyendo el dump: ${err.message}`, { code: 'DUMP_READ_FAILED', cause: err })));
      });
      input.pipe(child.stdin);
    }
  });
}
