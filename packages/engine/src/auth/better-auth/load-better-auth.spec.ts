import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '../..');
const LOADER = resolve(__dirname, 'load-better-auth.ts');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('load-better-auth', () => {
  it('is the only module under src/ that names the better-auth specifier', () => {
    const offenders = sourceFiles(SRC).filter(
      (file) =>
        file !== LOADER &&
        file !== __filename &&
        /['"`]better-auth(\/[^'"`]*)?['"`]/.test(readFileSync(file, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });
});
