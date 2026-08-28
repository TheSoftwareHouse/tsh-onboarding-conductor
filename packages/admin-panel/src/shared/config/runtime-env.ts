/**
 * The panel's configuration values come from two places depending on how it is served:
 * `import.meta.env`, inlined at build time by Vite, and `window.__ENV__`, written by the
 * container's entrypoint from its process environment at start-up. A container overrides the
 * build-time value; `pnpm dev` and Vitest never populate `window.__ENV__`, so the build-time
 * value is all that exists there.
 *
 * A key whose runtime value is an empty string — an unset Compose variable expands to `""` —
 * or not a string at all is dropped rather than merged in, so it falls through to the
 * build-time value instead of shadowing it with an empty value.
 */
export function readRuntimeEnv(): ImportMetaEnv {
  const runtimeEnv = window.__ENV__ ?? {};
  const overrides = Object.fromEntries(
    Object.entries(runtimeEnv).filter(([, value]) => typeof value === 'string' && value !== ''),
  );

  return { ...import.meta.env, ...overrides };
}
