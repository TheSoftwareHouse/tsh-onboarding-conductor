import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_MANIFEST_PATH, writeManifest } from './manifest-writer';
import type { SeedManifest } from './seed-manifest';

const MANIFEST: SeedManifest = {
  generatedAt: '2026-11-01T10:00:00.000Z',
  seed: 42,
  workflow: { id: 'analyst-investigation', version: 1 },
  scenarios: [
    {
      key: 'score-reject-01',
      onboardingId: '0196b3a2-0000-7000-8000-000000000001',
      expectedStatus: 'rejected',
      expectedStep: null,
      parked: false,
      explanation: 'rejected at collect_profile: risk 70 ≥ 60 (country RU +40, PEP +30)',
    },
  ],
};

describe('writeManifest', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'seeder-manifest-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('writes the manifest as JSON that reads back unchanged', async () => {
    const target = path.join(directory, 'manifest.json');

    await writeManifest(MANIFEST, target);

    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual(MANIFEST);
  });

  it('creates the missing output directory', async () => {
    const target = path.join(directory, 'out', 'nested', 'manifest.json');

    await writeManifest(MANIFEST, target);

    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual(MANIFEST);
  });

  it('replaces a manifest left by an earlier run', async () => {
    const target = path.join(directory, 'manifest.json');

    await writeManifest({ ...MANIFEST, seed: 1 }, target);
    await writeManifest(MANIFEST, target);

    expect(JSON.parse(await readFile(target, 'utf8')).seed).toBe(MANIFEST.seed);
  });

  it('defaults to out/manifest.json inside the package', () => {
    expect(DEFAULT_MANIFEST_PATH).toMatch(/packages\/onboarding-seeder\/out\/manifest\.json$/);
  });
});
