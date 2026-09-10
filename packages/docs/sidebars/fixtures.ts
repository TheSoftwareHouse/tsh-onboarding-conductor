import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

type ManifestEntry = { docId: string; scope: 'fixtures' | 'built-in' };

// `pnpm run fixtures:generate` writes one page per workflow file and this manifest. Sidebars load in
// Node, so the manifest is read here at build time; without it (typecheck before generation) the
// gallery stands alone.
const manifestPath = resolve(__dirname, '..', 'docs', 'fixtures', 'fixtures.manifest.json');
const manifest: ManifestEntry[] = existsSync(manifestPath)
  ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as ManifestEntry[])
  : [];

const idsIn = (scope: ManifestEntry['scope']): string[] =>
  manifest.filter((entry) => entry.scope === scope).map((entry) => entry.docId);

const sidebars: SidebarsConfig = {
  fixtures: [
    'index',
    ...(idsIn('fixtures').length
      ? [
          {
            type: 'category' as const,
            label: 'Examples',
            collapsible: false,
            items: idsIn('fixtures'),
          },
        ]
      : []),
    ...(idsIn('built-in').length
      ? [
          {
            type: 'category' as const,
            label: 'Built-in',
            collapsible: false,
            items: idsIn('built-in'),
          },
        ]
      : []),
  ],
};

export default sidebars;
