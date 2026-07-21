import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  webServer: {
    command:
      'VITE_ADMIN_PANEL_ENGINE_BASE_URL=http://localhost:3000 pnpm dev --host 127.0.0.1 --port 5174',
    url: process.env.BASE_URL || 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5174',
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
