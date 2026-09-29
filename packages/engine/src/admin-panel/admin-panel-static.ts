import { existsSync } from 'fs';
import { join, resolve } from 'path';

import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';

import {
  ADMIN_PANEL_RUNTIME_CONFIG_KEYS,
  AdminPanelRuntimeConfig,
  renderAdminPanelConfig,
} from './admin-panel-runtime-config';

/**
 * Every engine HTTP route is namespaced under this prefix — `v1/health`, `v1/onboardings`,
 * `v1/webhooks`, `v1/admin/*` — so the panel can own the root without shadowing the API. A
 * controller mounted outside it would start being answered with `index.html` instead.
 */
const API_ROUTE_PREFIX = '/v1';

const INDEX_FILE = 'index.html';
const CONFIG_SCRIPT_PATH = '/config.js';

/**
 * Where `packages/admin-panel`'s `vite build` output sits relative to this file, both compiled
 * (`packages/engine/dist/admin-panel/`) and under `ts-node` (`packages/engine/src/admin-panel/`):
 * three levels up is `packages/` in either case. Moving this file means changing this path.
 */
const DEFAULT_DIST_DIR = join(__dirname, '..', '..', '..', 'admin-panel', 'dist');

/**
 * Locates the panel's build output, or `undefined` when there is none to serve — which is the
 * normal case for `pnpm start:dev` and for the engine's own test runs, where the panel is served
 * by Vite on its own port or not at all. An `index.html` is what makes a directory servable, so
 * that is what is probed rather than the directory itself.
 */
export function findAdminPanelDist(configService: ConfigService): string | undefined {
  const configured = configService.get<string>('ADMIN_PANEL_DIST_DIR')?.trim();
  const distDir = resolve(configured || DEFAULT_DIST_DIR);

  return existsSync(join(distDir, INDEX_FILE)) ? distDir : undefined;
}

/** Whether a request is for the engine's own API rather than for the panel. */
export function isApiRequest(request: Pick<Request, 'originalUrl' | 'url'>): boolean {
  const path = (request.originalUrl || request.url || '').split('?')[0];

  return path === API_ROUTE_PREFIX || path.startsWith(`${API_ROUTE_PREFIX}/`);
}

function readRuntimeConfig(configService: ConfigService): AdminPanelRuntimeConfig {
  const config: AdminPanelRuntimeConfig = {};

  for (const key of ADMIN_PANEL_RUNTIME_CONFIG_KEYS) {
    config[key] = configService.get<string>(key);
  }

  // Derived, not configurable: the panel must see the environment the engine actually runs in.
  return { ...config, VITE_NODE_ENV: configService.get<string>('NODE_ENV') };
}

/**
 * Serves the admin panel's static build from the engine's own origin, and returns the directory
 * it is being served from — or `undefined` when there is no build to serve.
 *
 * The three handlers are registered on the underlying Express instance in call order, all of them
 * ahead of Nest's router, which is only mounted when the application initialises:
 *
 * 1. `/config.js` is rendered from configuration on every request and marked `no-store`, so a
 *    restart's new values are never masked by a cached copy. It is registered ahead of the static
 *    handler deliberately: `dist/config.js` exists as a placeholder (`window.__ENV__ = {}`) for
 *    `pnpm dev`, and serving that file here would hand the browser an empty configuration.
 * 2. The static handler serves real files. `index.html` is forced to revalidate — without it a
 *    browser may reuse a heuristically cached copy after a rebuild changes the hashed asset names
 *    it references, and the fallback below would answer the missing asset with that stale
 *    `index.html` and a 200 rather than surfacing the mismatch. Hashed files under `assets/` are
 *    untouched and stay cacheable.
 * 3. Anything left that is not an API path falls back to `index.html`, so a hard refresh on a
 *    client-side route such as `/audit` resolves instead of 404ing. This is the same
 *    `try_files $uri $uri/ /index.html` behaviour the panel's own nginx image used to provide,
 *    and it has the same consequence: an unknown non-API path answers 200 with the SPA shell.
 */
export function serveAdminPanel(
  app: NestExpressApplication,
  configService: ConfigService,
): string | undefined {
  const distDir = findAdminPanelDist(configService);

  if (!distDir) {
    return undefined;
  }

  const configScript = renderAdminPanelConfig(readRuntimeConfig(configService));
  const indexFile = join(distDir, INDEX_FILE);

  app.use(CONFIG_SCRIPT_PATH, (request: Request, response: Response, next: NextFunction) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      next();
      return;
    }

    response.setHeader('Cache-Control', 'no-store');
    response.type('application/javascript').send(configScript);
  });

  app.useStaticAssets(distDir, {
    index: false,
    redirect: false,
    setHeaders: (response: Response, filePath: string) => {
      if (filePath.endsWith(INDEX_FILE)) {
        response.setHeader('Cache-Control', 'no-cache');
      }
    },
  });

  app.use((request: Request, response: Response, next: NextFunction) => {
    if ((request.method !== 'GET' && request.method !== 'HEAD') || isApiRequest(request)) {
      next();
      return;
    }

    response.setHeader('Cache-Control', 'no-cache');
    response.sendFile(indexFile);
  });

  return distDir;
}
