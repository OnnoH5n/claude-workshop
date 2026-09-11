import { defineConfig } from 'vite';
import { apiPlugin } from './server/plugin.ts';

export default defineConfig({
  plugins: [apiPlugin()],
  server: {
    port: 5173,
    // Fail loudly rather than sliding to 5174 and silently breaking every baseURL.
    strictPort: true,
  },
});
