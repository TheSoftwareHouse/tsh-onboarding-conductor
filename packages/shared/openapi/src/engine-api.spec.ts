import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PACKAGE_DIR = resolve(__dirname, '..');
const COMMITTED_TYPES_FILE = join(__dirname, 'engine-api.d.ts');

describe('engine-api.d.ts', () => {
  it('equals a fresh generation from engine.openapi.json', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'engine-api-'));
    const freshFile = join(outputDir, 'engine-api.d.ts');

    try {
      execFileSync(
        join(PACKAGE_DIR, 'node_modules', '.bin', 'openapi-typescript'),
        ['engine.openapi.json', '-o', freshFile],
        { cwd: PACKAGE_DIR, stdio: 'pipe' },
      );

      expect(readFileSync(COMMITTED_TYPES_FILE, 'utf8')).toBe(readFileSync(freshFile, 'utf8'));
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
