// Files `pnpm run fixtures:generate` writes. Declared so `tsc` passes before generation has run;
// the bundler resolves the real files at build time.
declare module '@site/docs/fixtures/fixtures.manifest.json' {
  export type FixtureManifestEntry = {
    docId: string;
    scope: 'fixtures' | 'built-in';
    file: string;
    id: string;
    version: number;
    name: string;
    authoredAs: 'steps' | 'nodes';
    stepCount: number;
    connectorTypes: string[];
    connectorIds: string[];
    summary: string;
  };
  const manifest: FixtureManifestEntry[];
  export default manifest;
}

declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
