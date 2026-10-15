import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');

  return {
    plugins: [react()],
    base: '/returntrips/', // 👈 Add this
    server: {
      port: 5173,
      host: '0.0.0.0',
      proxy: {
        '/backend': {
          target:
            env.VITE_API_BASE_URL ||
            'https://shrouded-badly-facial.ngrok-free.dev',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/backend/, ''),
          headers: { 'ngrok-skip-browser-warning': 'true' },
          cookieDomainRewrite: '',
          // Keep the live event stream open while waiting for backend events.
          timeout: 0,
          proxyTimeout: 0,
        },
      },
    },
  };
});
