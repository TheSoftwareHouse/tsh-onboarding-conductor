/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

interface ImportMetaEnv {
  readonly VITE_ENGINE_API_BASE_URL?: string;
  readonly VITE_AUTH_ENABLED?: string;
  /** Set by the engine in `/config.js` when Microsoft sign-in is configured; never set at build time. */
  readonly VITE_AUTH_MICROSOFT_ENABLED?: string;
  /** The engine's own `NODE_ENV`, written into `/config.js` by the engine; never set at build time. */
  readonly VITE_NODE_ENV?: string;
  /** The engine's `ENVIRONMENT_NAME`, written into `/config.js` by the engine; never set at build time. */
  readonly VITE_ENVIRONMENT_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * Written by the container's entrypoint before the app bundle loads, from a `<script>` tag
 * serving `/config.js`. Absent under `pnpm dev` and in Vitest, where the Vite-inlined build-time
 * values are the only source. See `src/config/runtime-env.ts`.
 */
interface Window {
  __ENV__?: Partial<Record<keyof ImportMetaEnv, string>>;
}
