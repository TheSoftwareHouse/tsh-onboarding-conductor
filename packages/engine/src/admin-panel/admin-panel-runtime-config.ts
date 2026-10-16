/**
 * The admin panel is a static single-page app, so nothing in its bundle can read an environment
 * variable per request the way the engine reads `process.env`. It instead loads `/config.js`
 * before the app bundle and merges the `window.__ENV__` object it finds there over the values
 * Vite inlined at build time (see `packages/admin-panel/src/shared/config/runtime-env.ts`).
 *
 * This module renders that object from the engine's own configuration, which is what lets a
 * `.env` edit reach the panel on a container restart with no image rebuild.
 */

/**
 * The contract between the two halves: exactly the keys declared in
 * `packages/admin-panel/src/vite-env.d.ts`. A key added there needs adding here too, or the
 * panel will only ever see its build-time value.
 */
export const ADMIN_PANEL_RUNTIME_CONFIG_KEYS = [
  'VITE_ENGINE_API_BASE_URL',
  'VITE_AUTH_ENABLED',
  'VITE_SSO_PROVIDER',
  'VITE_AZURE_CLIENT_ID',
  'VITE_AZURE_TENANT_ID',
  'VITE_AZURE_API_SCOPE',
  'VITE_AZURE_REDIRECT_URI',
  'VITE_NODE_ENV',
  'VITE_ENVIRONMENT_NAME',
] as const;

export type AdminPanelRuntimeConfigKey = (typeof ADMIN_PANEL_RUNTIME_CONFIG_KEYS)[number];

export type AdminPanelRuntimeConfig = Partial<Record<AdminPanelRuntimeConfigKey, string>>;

/**
 * The engine serves the panel from its own origin, so the API the panel calls is always this
 * same origin. Emitting a relative base URL rather than an absolute one keeps the panel working
 * behind whatever host, port or reverse proxy the deployment puts in front of it — including a
 * remapped `ENGINE_PORT`, which an absolute `http://localhost:3000` would get wrong.
 * `VITE_ENGINE_API_BASE_URL` still overrides it, for a deployment that splits the two again.
 */
export const SAME_ORIGIN_API_BASE_URL = '/';

/**
 * Renders the `/config.js` body. Values are embedded with `JSON.stringify`, so quotes,
 * backslashes and line breaks in a configured value cannot break out of the object literal.
 * `<` is escaped as well: the script is served as an external `.js` file today, where `<` is not
 * special, but the escape costs nothing and survives the body being inlined into HTML later.
 *
 * A key that is unset, empty or whitespace-only is omitted rather than written as `""`, because
 * `readRuntimeEnv()` drops empty values and falls through to the build-time value — writing one
 * would be indistinguishable from not writing it at all, only noisier.
 */
export function renderAdminPanelConfig(config: AdminPanelRuntimeConfig): string {
  const values: AdminPanelRuntimeConfig = {
    VITE_ENGINE_API_BASE_URL: SAME_ORIGIN_API_BASE_URL,
  };

  for (const key of ADMIN_PANEL_RUNTIME_CONFIG_KEYS) {
    const value = config[key];

    if (typeof value === 'string' && value.trim() !== '') {
      values[key] = value.trim();
    }
  }

  const serialized = JSON.stringify(values, null, 2).replace(/</g, '\\u003c');

  return `window.__ENV__ = ${serialized};\n`;
}
