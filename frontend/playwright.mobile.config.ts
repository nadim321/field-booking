import { defineConfig } from '@playwright/test';
// Phone-sized checks of the staff screens. Uses mocked API responses, so no MySQL is required.
export default defineConfig({
  testDir: './e2e-mobile', workers: 1, timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:5066', trace: 'retain-on-failure', launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {} },
  webServer: { command: 'node e2e-mobile/static-server.js', url: 'http://127.0.0.1:5066/', reuseExistingServer: false, timeout: 30000 }
});
