// Ejecución de mongorestore (MongoDB Database Tools) en este servidor. Sin shell y
// sin la contraseña en los argumentos: la URI va en un archivo `--config` temporal
// (permisos 0600) que se borra al terminar. El archivo entra por stdin en streaming.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../../config/index.js';
import { InfraError } from '../../domain/errors.js';
import {
  buildMongoUri, buildMongorestoreArgs, cleanMongoLine, mongorestoreConfig, parseRestoreSummary,
} from '../../domain/mongo.js';
import { runTool, toolPath } from '../postgres/nativeTools.js';

const MISSING_HINT = 'instala MongoDB Database Tools (mongodb-database-tools) en el servidor o configura MONGO_BIN_DIR';

export const mongorestorePath = () => toolPath('mongorestore', config.nativeRestore.mongoBinDir);

/** Versión de mongorestore ("mongorestore version: 100.11.0"). Lanza si no está instalado. */
export async function mongorestoreVersion() {
  const { code, stdout } = await runTool({
    cmd: mongorestorePath(), args: ['--version'], timeoutMs: 15_000, missingHint: MISSING_HINT,
  });
  const line = stdout.split(/\r?\n/).find((l) => /version/i.test(l))?.trim();
  if (code !== 0 || !line) throw new InfraError(`mongorestore --version falló: ${stdout.trim()}`, { code: 'NATIVE_TOOLS_MISSING' });
  return line;
}

/**
 * Restaura un archivo de mongodump en `targetDb`.
 * @param conn     conexión de la instancia (host, user, password, mongoSrv, connOptions)
 * @param input    Readable con el archivo tal cual (comprimido si gzip)
 * @param onLine   (level, text) por cada línea útil de salida (sin barras de progreso)
 * -> { ok, summary: { restored, failed } | null, error? }
 */
export async function runMongorestore({ conn, input, gzip, sourceDb, targetDb, signal = null, onLine = () => {} }) {
  const dir = await mkdtemp(join(tmpdir(), 'dbrefresh-mongo-'));
  const configFile = join(dir, 'mongorestore.yaml');
  try {
    await writeFile(configFile, mongorestoreConfig(buildMongoUri(conn)), { mode: 0o600 });
    let summary = null;
    const { code, tail, linesOmitted } = await runTool({
      cmd: mongorestorePath(),
      args: buildMongorestoreArgs({ configFile, gzip, sourceDb, targetDb }),
      input,
      keepStdout: false,
      timeoutMs: config.nativeRestore.timeoutSeconds * 1000,
      signal,
      missingHint: MISSING_HINT,
      transformLine: cleanMongoLine, // sin barras de progreso ni marca de tiempo
      onLine: (line) => {
        const isSummary = parseRestoreSummary(line);
        onLine(/\bfailed:|\berror\b/i.test(line) && !isSummary ? 'error' : 'info', line);
      },
    });
    // El resumen es la última línea: se toma de `tail` (onLine deja de recibir tras el tope).
    for (const line of tail) summary = parseRestoreSummary(line) ?? summary;
    if (linesOmitted) onLine('warning', `${linesOmitted} línea(s) de salida adicionales omitidas.`);
    if (code !== 0 || (summary && summary.failed > 0)) {
      const last = tail.slice(-3).join(' | ');
      const hint = /wire version/i.test(last)
        ? ' (servidor anterior a lo que soporta esta versión de mongorestore: instala unas Database Tools compatibles y configura MONGO_BIN_DIR)'
        : '';
      return { ok: false, summary, error: { message: `mongorestore terminó con código ${code}: ${last}${hint}` } };
    }
    return { ok: true, summary };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
