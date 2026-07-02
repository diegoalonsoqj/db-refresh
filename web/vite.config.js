import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// La API corre en :5000. En dev, Vite (5173) proxya /api -> :5000 para que las
// peticiones sean same-origin y la cookie httpOnly (SameSite=Strict) funcione.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true },
    },
  },
});
