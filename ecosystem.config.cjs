// Configuración de PM2 para producción: API + worker + scheduler.
// .cjs porque el proyecto es ESM ("type": "module") y PM2 carga este fichero con require().
//
//   pm2 start ecosystem.config.cjs --env production
//   pm2 save                      # persiste la lista de procesos
//   pm2 startup                   # (una vez) registra PM2 como servicio del SO -> arranca al reiniciar el host
//
// Memoria: VPS de 4 GB -> 2 GB para la app en total (los otros 2 GB quedan para el SO y
// PostgreSQL). Reparto: API 1 GB, worker 768 MB, scheduler 256 MB. En cada proceso el heap
// de V8 se limita ~25% por debajo del umbral para que el GC actúe antes; `max_memory_restart`
// (RSS = heap + buffers nativos) es solo la red de seguridad ante una fuga real.
// Uso normal esperado: decenas a pocos cientos de MB por proceso.

const memory = (maxRss, heapMb) => ({
  max_memory_restart: maxRss,
  node_args: `--max-old-space-size=${heapMb}`,
});

const common = {
  cwd: __dirname, // .env se lee del directorio de trabajo
  exec_mode: 'fork',
  instances: 1,
  autorestart: true, // si el proceso cae, PM2 lo levanta
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
      ...memory('1G', 768),
      script: 'server/index.js',
      out_file: 'logs/api.out.log',
      error_file: 'logs/api.err.log',
      kill_timeout: 10_000, // server.close() + cierre del pool
    },
    {
      ...common,
      name: 'db-refresh-worker',
      ...memory('768M', 576),
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
      ...memory('256M', 192),
      script: 'server/jobs/scheduler.js',
      out_file: 'logs/scheduler.out.log',
      error_file: 'logs/scheduler.err.log',
      kill_timeout: 10_000,
    },
  ],
};
