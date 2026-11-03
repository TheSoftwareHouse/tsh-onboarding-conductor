import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SeedManifest } from './seed-manifest';

/** `packages/onboarding-seeder/out/manifest.json`, which `.gitignore` excludes. */
export const DEFAULT_MANIFEST_PATH = path.resolve(__dirname, '..', '..', 'out', 'manifest.json');

export async function writeManifest(
  manifest: SeedManifest,
  manifestPath: string = DEFAULT_MANIFEST_PATH,
): Promise<void> {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
