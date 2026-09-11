import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: '.artifacts/playwright-report', open: 'never' }]],
  outputDir: '.artifacts/test-results',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  // Two processes now: the Python API, and Vite serving the frontend and proxying
  // /api to it. Both reuse an already-running instance rather than starting a second.
  webServer: [
    {
      command: 'backend/.venv/bin/uvicorn main:app --app-dir backend --port 8000',
      url: 'http://127.0.0.1:8000/api/portfolio',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
