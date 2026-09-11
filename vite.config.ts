import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    // Fail loudly rather than sliding to 5174 and silently breaking every baseURL.
    strictPort: true,
    // The browser still sees a single origin, so no CORS and no absolute API URLs
    // in the frontend. The Python service behind this is the only thing that talks
    // to Postgres.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: false,
      },
    },
  },
});
