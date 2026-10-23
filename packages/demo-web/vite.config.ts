import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';

const ENV_DIR = '../..';

/** cloudflared quick tunnels hand out a random host under this domain. */
const CLOUDFLARE_QUICK_TUNNEL_DOMAIN = '.trycloudflare.com';
const DEFAULT_BFF_PORT = 3100;
/** The BFF routes the dev server proxies, so the page and its API share one origin through a tunnel. */
const BFF_PROXY_PATHS = ['/v1/bnpl', '/health'];

function readEnv(mode: string): Record<string, string> {
  return loadEnv(mode, fileURLToPath(new URL(ENV_DIR, import.meta.url)), '');
}

/**
 * The public hosts the demo may be opened on through a tunnel (KSA journey): any cloudflared quick
 * tunnel, plus `DEMO_WEB_PUBLIC_ORIGIN`'s host when set; the dev server refuses every other host
 * than localhost.
 */
function publicHosts(env: Record<string, string>): string[] {
  const origin = env.DEMO_WEB_PUBLIC_ORIGIN;

  try {
    return origin
      ? [CLOUDFLARE_QUICK_TUNNEL_DOMAIN, new URL(origin).hostname]
      : [CLOUDFLARE_QUICK_TUNNEL_DOMAIN];
  } catch {
    return [CLOUDFLARE_QUICK_TUNNEL_DOMAIN];
  }
}

/** `/v1/bnpl/*` and `/health` go to the BFF on `DEMO_BFF_PORT`, so one tunnel serves both. */
function bffProxy(env: Record<string, string>) {
  const target = `http://localhost:${env.DEMO_BFF_PORT || DEFAULT_BFF_PORT}`;

  return Object.fromEntries(BFF_PROXY_PATHS.map((path) => [path, { target, changeOrigin: false }]));
}

export default defineConfig(({ mode }) => ({
  // Tailwind runs through PostCSS (`postcss.config.js`), which Vite picks up on its own.
  plugins: [react()],
  envDir: ENV_DIR,
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    allowedHosts: publicHosts(readEnv(mode)),
    proxy: bffProxy(readEnv(mode)),
  },
  preview: { port: 5173, strictPort: true },
  test: {
    environment: 'jsdom',
    // Matches the repo's Jest base config: no call history or stubbed behaviour leaks between tests.
    mockReset: true,
    setupFiles: ['./vitest.setup.ts'],
    exclude: [...configDefaults.exclude, 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.spec.{ts,tsx}', 'src/components/ui/**', 'src/main.tsx'],
    },
  },
}));
