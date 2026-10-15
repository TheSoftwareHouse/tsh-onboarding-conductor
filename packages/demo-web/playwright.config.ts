import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = 5173;
// Not the Compose BFF's 3100: a developer's BFF there targets another workflow, and
// `reuseExistingServer` would silently drive it.
const BFF_PORT = 3101;
const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
const BFF_ORIGIN = `http://localhost:${BFF_PORT}`;
const BUILD_TIMEOUT_MS = 120_000;
// The default ports of the root `pnpm test:e2e` stack; a shifted stack overrides both.
const ENGINE_BASE_URL = process.env.ENGINE_BASE_URL ?? 'http://localhost:3000';
const UPLOAD_PUBLIC_HOST = process.env.UPLOAD_PUBLIC_HOST ?? 'http://localhost:3900';
const PERSONAS_DIR = fileURLToPath(new URL('../demo-bff/personas', import.meta.url));

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL || WEB_ORIGIN,
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  // The journey needs the BFF and the web app. Both start here so the root `pnpm test:e2e`
  // fan-out (which only brings up the engine) is enough. `BASE_URL` points at an app that is
  // already running, so nothing is started then.
  webServer: process.env.BASE_URL
    ? undefined
    : [
        {
          // `start:e2e` compiles without `nest build`: its `deleteOutDir` plus the incremental
          // build info leaves `dist` empty on the second run.
          command: 'pnpm --filter @tsh/demo-bff start:e2e',
          url: `${BFF_ORIGIN}/v1/bnpl/personas`,
          reuseExistingServer: !process.env.CI,
          timeout: BUILD_TIMEOUT_MS,
          env: {
            NODE_ENV: 'test',
            DEMO_BFF_PORT: String(BFF_PORT),
            DEMO_WEB_ORIGIN: WEB_ORIGIN,
            ENGINE_BASE_URL,
            ENGINE_REQUEST_TIMEOUT_MS: '10000',
            BNPL_WORKFLOW_ID: 'credit-check',
            UPLOAD_PUBLIC_HOST,
            PERSONAS_DIR,
          },
        },
        {
          command: 'pnpm build && pnpm preview',
          url: WEB_ORIGIN,
          reuseExistingServer: !process.env.CI,
          timeout: BUILD_TIMEOUT_MS,
          env: { VITE_BNPL_BFF_BASE_URL: BFF_ORIGIN },
        },
      ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
