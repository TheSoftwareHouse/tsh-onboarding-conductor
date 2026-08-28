import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL || 'http://localhost:5174';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  outputDir: 'dist/test-results',
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Bind the dev server to whatever BASE_URL names. Without the explicit port Vite always takes
    // its default, so overriding BASE_URL pointed the suite at a server that was never started.
    command: `pnpm dev --port ${new URL(baseURL).port || '5174'} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
  },
});
