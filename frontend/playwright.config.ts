import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', workers: 1, timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:5055', trace: 'retain-on-failure', launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {} },
  webServer: {
    command: 'node ../backend/tests/e2e-server.js', url: 'http://127.0.0.1:5055/health/ready',
    env: { NODE_ENV: 'test' }, reuseExistingServer: false, timeout: 60000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 }
  }
});
