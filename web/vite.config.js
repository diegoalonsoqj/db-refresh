import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// En dev, Vite (5173) proxya /api -> la API para que las peticiones sean
// same-origin y la cookie httpOnly (SameSite=Strict) funcione.
//
// El puerto se toma del .env de la raíz (el mismo PORT que lee la API) para que
// proxy y API no puedan desalinearse.
export default defineConfig(({ mode }) => {
  // El 3er argumento ('') carga TODAS las variables, no solo las VITE_*.
  const env = loadEnv(mode, ROOT, '');
  const apiPort = env.PORT || '3004';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true },
      },
    },
  };
});
