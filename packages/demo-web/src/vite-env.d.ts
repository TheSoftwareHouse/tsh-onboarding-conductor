/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the demo BFF, e.g. `http://localhost:3100`. */
  readonly VITE_BNPL_BFF_BASE_URL?: string;
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
