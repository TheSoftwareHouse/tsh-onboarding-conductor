/**
 * The only module that names the `better-auth` specifier.
 *
 * Mechanism: dynamic `import()` hidden from the TypeScript emitter, with type-only imports.
 * better-auth is ESM-only (`"type": "module"`, no CommonJS build) and the engine emits CommonJS
 * (`module: commonjs`), which would turn a static `import` or a plain `import()` into `require()`,
 * and `require()` cannot load it. `(0, eval)('import(...)')` keeps native import semantics under
 * `nest build`, ts-node and Jest (`--experimental-vm-modules`), the same way `file-type` is loaded
 * in `src/storage/s3-object-storage.service.ts`. Types come from `import type`, which is erased;
 * the package's `typesVersions` makes them resolve under the engine's CommonJS resolution.
 *
 * Rejected: switching `module` / `moduleResolution` to `node16` / `nodenext`. It would make every
 * relative import in the engine need a file extension and moves the whole package to a different
 * emitted format for the sake of one dependency.
 *
 * Callers import types from here (`import type { BetterAuthInstance } from './load-better-auth'`)
 * and take runtime exports from `loadBetterAuth()`; plugins and access control arrive through the
 * same result, never through their own `better-auth/...` import.
 */
import type { betterAuth } from 'better-auth';
import type * as Api from 'better-auth/api';
import type { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import type * as Plugins from 'better-auth/plugins';
import type * as Access from 'better-auth/plugins/access';
import type * as OrganizationAccess from 'better-auth/plugins/organization/access';

export interface BetterAuthRuntime {
  betterAuth: typeof betterAuth;
  toNodeHandler: typeof toNodeHandler;
  fromNodeHeaders: typeof fromNodeHeaders;
  api: typeof Api;
  plugins: typeof Plugins;
  access: typeof Access;
  organizationAccess: typeof OrganizationAccess;
}

export type BetterAuthInstance = ReturnType<typeof betterAuth>;

let runtime: Promise<BetterAuthRuntime> | undefined;

export function loadBetterAuth(): Promise<BetterAuthRuntime> {
  runtime ??= importBetterAuth();
  return runtime;
}

async function importBetterAuth(): Promise<BetterAuthRuntime> {
  // V8 caches indirect-eval code by source text, and the cached function keeps the host-defined
  // options (Jest's `importModuleDynamically`) of the first context that compiled it. Identical
  // source in a later Jest test file would link through that file's torn-down environment ("Test
  // environment has been torn down"), so every call gets source of its own.
  // eslint-disable-next-line no-eval
  const load = <T>(specifier: string): Promise<T> =>
    (0, eval)(`import(${JSON.stringify(specifier)}) /* ${Math.random()} */`);
  // Sequential on purpose: Jest 29's ESM linker rejects concurrent imports that share a
  // dependency ("request for '@better-auth/core/error' can not be resolved").
  const core = await load<{ betterAuth: typeof betterAuth }>('better-auth');
  const node = await load<{
    fromNodeHeaders: typeof fromNodeHeaders;
    toNodeHandler: typeof toNodeHandler;
  }>('better-auth/node');
  const api = await load<typeof Api>('better-auth/api');
  const plugins = await load<typeof Plugins>('better-auth/plugins');
  const access = await load<typeof Access>('better-auth/plugins/access');
  const organizationAccess = await load<typeof OrganizationAccess>(
    'better-auth/plugins/organization/access',
  );
  return {
    betterAuth: core.betterAuth,
    toNodeHandler: node.toNodeHandler,
    fromNodeHeaders: node.fromNodeHeaders,
    api,
    plugins,
    access,
    organizationAccess,
  };
}
