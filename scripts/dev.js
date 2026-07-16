// Lanzador de desarrollo: levanta la API, el worker, el scheduler y el frontend
// de Vite desde un solo comando, multiplexando la salida de todos y apagándolos
// en bloque con Ctrl+C.
//
// Solo para desarrollo. En producción cada proceso se ejecuta por separado
// (ver README): este script no cambia cómo arranca ninguno de ellos, solo los
// invoca con los mismos entrypoints que los scripts de package.json.
//
//   node scripts/dev.js              -> api, worker, scheduler, web
//   node scripts/dev.js api web      -> solo los indicados
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';

// Cada servicio replica el entrypoint de su script en package.json.
const SERVICES = [
  { name: 'api', color: '\x1b[36m', args: ['--watch', 'server/index.js'] },
  { name: 'worker', color: '\x1b[35m', args: ['server/jobs/worker.js'] },
  { name: 'scheduler', color: '\x1b[33m', args: ['server/jobs/scheduler.js'] },
  {
    name: 'web',
    color: '\x1b[32m',
    args: [join(ROOT, 'web', 'node_modules', 'vite', 'bin', 'vite.js')],
    cwd: join(ROOT, 'web'),
  },
];

const PAD = Math.max(...SERVICES.map((s) => s.name.length));

function log(service, line) {
  const tag = service.name.padEnd(PAD);
  process.stdout.write(`${service.color}${tag}${RESET} ${DIM}|${RESET} ${line}\n`);
}

function fail(message) {
  process.stderr.write(`${RED}dev:${RESET} ${message}\n`);
  process.exit(1);
}

/** Comprueba lo imprescindible para que el arranque no falle de forma confusa. */
function preflight(selected) {
  if (!existsSync(join(ROOT, '.env'))) {
    fail('falta .env en la raíz (cópialo de .env.example); la config lo necesita para arrancar');
  }
  if (!existsSync(join(ROOT, 'node_modules'))) fail('faltan dependencias: ejecuta `npm install`');
  if (selected.some((s) => s.name === 'web') && !existsSync(join(ROOT, 'web', 'node_modules'))) {
    fail('faltan dependencias del frontend: ejecuta `npm --prefix web install`');
  }
}

function parseSelection() {
  const names = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (names.length === 0) return SERVICES;
  const unknown = names.filter((n) => !SERVICES.some((s) => s.name === n));
  if (unknown.length > 0) {
    fail(`servicio desconocido: ${unknown.join(', ')} (válidos: ${SERVICES.map((s) => s.name).join(', ')})`);
  }
  return SERVICES.filter((s) => names.includes(s.name));
}

/** Emite la salida del hijo línea a línea, prefijada, sin cortar líneas parciales. */
function pipeLines(stream, service) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) log(service, line);
  });
  stream.on('end', () => {
    if (buffer.length > 0) log(service, buffer);
  });
}

const children = new Map();
let shuttingDown = false;

function start(service) {
  const child = spawn(process.execPath, service.args, {
    cwd: service.cwd ?? ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    // FORCE_COLOR: los hijos no ven un TTY (stdout va a un pipe) y sin esto
    // desactivarían el color de pino y de Vite.
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  pipeLines(child.stdout, service);
  pipeLines(child.stderr, service);

  child.on('exit', (code, signal) => {
    children.delete(service.name);
    if (shuttingDown) return;
    log(service, `${DIM}terminó (${signal ?? `código ${code}`})${RESET}`);
    // Fail-fast: si uno cae, no dejamos el resto a medias simulando que todo va bien.
    shutdown(code ?? 1);
  });

  children.set(service.name, child);
  return child;
}

/**
 * Mata a los hijos. En Windows un `kill` al proceso no alcanza a sus nietos
 * (p.ej. los que arranque Vite), así que se usa taskkill sobre el árbol.
 */
function killTree(child) {
  if (process.platform !== 'win32') {
    child.kill('SIGTERM');
    return;
  }
  spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    .on('error', () => child.kill());
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children.values()) killTree(child);
  // Margen para que los hijos mueran antes de que el padre se vaya.
  setTimeout(() => process.exit(code), 500).unref();
}

const selected = parseSelection();
preflight(selected);

for (const service of selected) start(service);

process.stdout.write(
  `${DIM}dev: ${selected.map((s) => s.name).join(', ')} — Ctrl+C para parar todo${RESET}\n`,
);

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
