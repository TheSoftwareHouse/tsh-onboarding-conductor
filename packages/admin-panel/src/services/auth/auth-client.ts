import { createAuthClient } from 'better-auth/react';
import { adminClient, organizationClient, twoFactorClient } from 'better-auth/client/plugins';
import { readRuntimeEnv } from '@/config/runtime-env';

const AUTH_BASE_PATH = '/v1/auth';

/**
 * The engine serves better-auth under `/v1/auth`. better-auth refuses a relative base URL, so the
 * engine base URL is resolved against the page's origin: unset, or the engine-rendered `/` (the
 * panel served by the engine itself), both become the origin that served the panel.
 */
function buildAuthBaseUrl(): string {
  const engineBaseUrl = new URL(
    readRuntimeEnv().VITE_ENGINE_API_BASE_URL?.trim() || '/',
    window.location.origin,
  ).href;

  return `${engineBaseUrl.replace(/\/+$/, '')}${AUTH_BASE_PATH}`;
}

/**
 * The panel's single better-auth client. The session is an httpOnly cookie, so requests are sent
 * with credentials: that is what lets the cross-origin `pnpm dev` panel reach the engine.
 */
export const authClient = createAuthClient({
  baseURL: buildAuthBaseUrl(),
  fetchOptions: { credentials: 'include' },
  plugins: [twoFactorClient(), organizationClient(), adminClient()],
});
