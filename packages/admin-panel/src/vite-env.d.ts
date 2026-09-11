/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

interface ImportMetaEnv {
  readonly VITE_ENGINE_API_BASE_URL?: string;
  readonly VITE_AUTH_ENABLED?: string;
  readonly VITE_SSO_PROVIDER?: string;
  readonly VITE_AZURE_CLIENT_ID?: string;
  readonly VITE_AZURE_TENANT_ID?: string;
  readonly VITE_AZURE_API_SCOPE?: string;
  readonly VITE_AZURE_REDIRECT_URI?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * Written by the container's entrypoint before the app bundle loads, from a `<script>` tag
 * serving `/config.js`. Absent under `pnpm dev` and in Vitest, where the Vite-inlined build-time
 * values are the only source. See `src/shared/config/runtime-env.ts`.
 */
interface Window {
  __ENV__?: Partial<Record<keyof ImportMetaEnv, string>>;
}
