import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectChangedFiles } from './runner';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@invalid', ...args], {
    cwd,
    stdio: 'pipe',
  }).toString();

describe('collectChangedFiles', () => {
  let sandbox: string;
  let baseline: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'skill-evals-changes-'));
    writeFileSync(join(sandbox, 'tracked.txt'), 'a');
    mkdirSync(join(sandbox, 'dir'));
    writeFileSync(join(sandbox, 'dir', 'keep.txt'), 'b');
    git(sandbox, 'init', '-q');
    git(sandbox, 'add', '-A');
    git(sandbox, 'commit', '-q', '--no-verify', '-m', 'baseline');
    baseline = git(sandbox, 'rev-parse', 'HEAD').trim();
  });

  afterEach(() => {
    rmSync(sandbox, { force: true, recursive: true });
  });

  it('reports nothing for a tree still at its baseline', () => {
    expect(collectChangedFiles(sandbox, baseline)).toEqual([]);
    expect(collectChangedFiles(sandbox)).toEqual([]);
  });

  it('measures against the baseline commit, so a change the agent committed still counts', () => {
    writeFileSync(join(sandbox, 'committed.json'), '{}');
    git(sandbox, 'add', 'committed.json');
    git(sandbox, 'commit', '-q', '--no-verify', '-m', 'agent: publish');
    writeFileSync(join(sandbox, 'staged.txt'), 's');
    git(sandbox, 'add', 'staged.txt');
    writeFileSync(join(sandbox, 'untracked.txt'), 'u');
    writeFileSync(join(sandbox, 'tracked.txt'), 'changed');
    git(sandbox, 'rm', '-q', 'dir/keep.txt');

    expect(collectChangedFiles(sandbox, baseline)).toEqual([
      { status: 'A', path: 'committed.json' },
      { status: 'D', path: 'dir/keep.txt' },
      { status: 'A', path: 'staged.txt' },
      { status: 'M', path: 'tracked.txt' },
      { status: '??', path: 'untracked.txt' },
    ]);

    // Without a baseline it is the working tree as `git status` sees it: the committed file is
    // gone, which is the view the ablation wants and the golden sets must not use.
    expect(collectChangedFiles(sandbox)).toEqual([
      { status: 'D', path: 'dir/keep.txt' },
      { status: 'A', path: 'staged.txt' },
      { status: 'M', path: 'tracked.txt' },
      { status: '??', path: 'untracked.txt' },
    ]);
  });
});
