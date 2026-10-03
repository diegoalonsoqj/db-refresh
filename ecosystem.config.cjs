// Configuración de PM2 para producción: API + worker + scheduler.
// .cjs porque el proyecto es ESM ("type": "module") y PM2 carga este fichero con require().
//
//   pm2 start ecosystem.config.cjs --env production
//   pm2 save                      # persiste la lista de procesos
//   pm2 startup                   # (una vez) registra PM2 como servicio del SO -> arranca al reiniciar el host
//
// Memoria: tope de 2 GB por proceso. El heap de V8 se limita por debajo (1792 MB) para
// que el GC actúe antes de llegar al umbral de PM2; `max_memory_restart` queda como red de
// seguridad (RSS = heap + buffers nativos) y solo reinicia si de verdad se superan los 2 GB.

const MAX_MEMORY = '2G';
const NODE_ARGS = '--max-old-space-size=1792';

const common = {
  cwd: __dirname, // .env se lee del directorio de trabajo
  exec_mode: 'fork',
  instances: 1,
  autorestart: true, // si el proceso cae, PM2 lo levanta
  max_memory_restart: MAX_MEMORY,
  node_args: NODE_ARGS,
  // Siempre arriba: tras un reinicio del host PostgreSQL puede tardar en aceptar conexiones;
  // en vez de rendirse tras N fallos, reintenta con backoff exponencial (tope ~15s de PM2).
  exp_backoff_restart_delay: 200,
  max_restarts: 100_000,
  merge_logs: true,
  time: true, // timestamp en los logs de PM2
  env: { NODE_ENV: 'development' },
  env_production: { NODE_ENV: 'production' },
};

module.exports = {
  apps: [
    {
      ...common,
      name: 'db-refresh-api',
      script: 'server/index.js',
      out_file: 'logs/api.out.log',
      error_file: 'logs/api.err.log',
      kill_timeout: 10_000, // server.close() + cierre del pool
    },
    {
      ...common,
      name: 'db-refresh-worker',
      script: 'server/jobs/worker.js',
      out_file: 'logs/worker.out.log',
      error_file: 'logs/worker.err.log',
      // El shutdown espera a que termine el job en curso (DROP + import en Cloud SQL).
      // Margen amplio antes del SIGKILL para no cortar un restore a medias.
      kill_timeout: 15 * 60_000,
    },
    {
      ...common,
      name: 'db-refresh-scheduler',
      script: 'server/jobs/scheduler.js',
      out_file: 'logs/scheduler.out.log',
      error_file: 'logs/scheduler.err.log',
      kill_timeout: 10_000,
    },
  ],
};
