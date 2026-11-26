declare const require: (moduleName: string) => unknown;
declare const process: { cwd: () => string };

const { existsSync, readFileSync } = require('fs') as {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: string) => string;
};
const { dirname, join, resolve } = require('path') as {
  dirname: (path: string) => string;
  join: (...paths: string[]) => string;
  resolve: (...paths: string[]) => string;
};

// Jest runs from the package root, as `workflow-validator.spec.ts` relies on too.
const PACKAGE_ROOT = process.cwd();
const SOURCE_ROOT = join(PACKAGE_ROOT, 'src');
const ROOT_SUBPATH = '.';
const RUNTIME_SUBPATHS = ['./workflow-validator'];
const RUNTIME_DEPENDENCY = /^ajv(-formats)?(\/|$)/;
const IMPORT_SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

const readExports = (): Record<string, { types: string }> =>
  JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).exports;

/** `./dist/step-types.d.ts` → `src/step-types.ts`. */
const toSourceEntry = (typesPath: string): string =>
  join(SOURCE_ROOT, typesPath.replace('./dist/', '').replace(/\.d\.ts$/, '.ts'));

const resolveRelative = (from: string, specifier: string): string => {
  const base = resolve(dirname(from), specifier);

  return existsSync(`${base}.ts`) ? `${base}.ts` : join(base, 'index.ts');
};

/** Every package the entry's module graph imports, found by walking its relative imports. */
const collectExternalImports = (entry: string): Set<string> => {
  const visited = new Set<string>();
  const external = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.shift() as string;

    if (visited.has(file)) {
      continue;
    }

    visited.add(file);

    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(IMPORT_SPECIFIER)) {
      if (specifier.startsWith('.')) {
        queue.push(resolveRelative(file, specifier));
      } else {
        external.add(specifier);
      }
    }
  }

  return external;
};

const runtimeFreeSubpaths = Object.entries(readExports()).filter(
  ([subpath, target]) =>
    subpath !== ROOT_SUBPATH &&
    !RUNTIME_SUBPATHS.includes(subpath) &&
    typeof target === 'object' &&
    target.types !== undefined,
);

describe('runtime-free subpaths', () => {
  it('finds the subpaths to check', () => {
    expect(runtimeFreeSubpaths.map(([subpath]) => subpath)).toEqual(
      expect.arrayContaining(['./step-types', './workflow-schema', './workflow-contract']),
    );
  });

  it.each([ROOT_SUBPATH, ...RUNTIME_SUBPATHS])(
    '%s reaches ajv, so the walker can see it',
    (subpath) => {
      const target = readExports()[subpath];
      const reached = [...collectExternalImports(toSourceEntry(target.types))];

      expect(reached.some((specifier) => RUNTIME_DEPENDENCY.test(specifier))).toBe(true);
    },
  );

  it.each(runtimeFreeSubpaths)('%s never reaches ajv', (_subpath, target) => {
    const reached = [...collectExternalImports(toSourceEntry(target.types))].filter((specifier) =>
      RUNTIME_DEPENDENCY.test(specifier),
    );

    expect(reached).toEqual([]);
  });
});
