import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectSkillChanges, reminder, skillOf, skillsForPaths, stopDecision } from './reminder';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@invalid', ...args], {
    cwd,
    stdio: 'pipe',
  }).toString();

describe('skillOf', () => {
  it('names the skill a path belongs to, wherever inside it the file sits', () => {
    expect(skillOf('.claude/skills/creating-workflows/SKILL.md')).toBe('creating-workflows');
    expect(skillOf('.claude/skills/creating-workflows/references/step-types.md')).toBe(
      'creating-workflows',
    );
    expect(skillOf('.claude/skills/creating-engine-bffs/evals/evals.json')).toBe(
      'creating-engine-bffs',
    );
  });

  it('names nothing for a path outside the skills', () => {
    expect(skillOf('.claude/rules/testing.md')).toBeUndefined();
    expect(skillOf('packages/engine/src/main.ts')).toBeUndefined();
    expect(skillOf('.claude/skills')).toBeUndefined();
  });
});

describe('skillsForPaths', () => {
  it('reports each skill once, in a stable order, ignoring what is not a path', () => {
    expect(
      skillsForPaths([
        '.claude/skills/creating-workflows/SKILL.md',
        '.claude/skills/creating-workflows/evals/evals.json',
        '.claude/skills/creating-engine-bffs/SKILL.md',
        'README.md',
        undefined,
        '',
      ]),
    ).toEqual(['creating-engine-bffs', 'creating-workflows']);
  });
});

describe('reminder', () => {
  it('carries the command for the skill that changed and the account the suite runs on', () => {
    const text = reminder(['creating-workflows']);

    expect(text).toContain('pnpm skills:evals --case creating-workflows');
    expect(text).toContain('signed-in Claude Code account');
    expect(text).toContain('no CI workflow');
  });

  it('names every skill that changed', () => {
    const text = reminder(['creating-engine-bffs', 'creating-workflows']);

    expect(text).toContain('2 skills changed');
    expect(text).toContain('pnpm skills:evals --case creating-engine-bffs');
    expect(text).toContain('pnpm skills:evals --case creating-workflows');
  });
});

describe('collectSkillChanges', () => {
  let repository: string;
  const skillFile = join('.claude', 'skills', 'demo-skill', 'SKILL.md');

  const write = (relative: string, contents: string) => {
    const absolute = join(repository, relative);

    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, contents);
  };

  beforeEach(() => {
    repository = mkdtempSync(join(tmpdir(), 'skill-evals-reminder-'));
    git(repository, 'init', '-q');
    write(skillFile, '# demo\n');
    write('README.md', 'readme\n');
    git(repository, 'add', '-A');
    git(repository, 'commit', '-q', '--no-verify', '-m', 'baseline');
  });

  afterEach(() => {
    rmSync(repository, { force: true, recursive: true });
  });

  it('reports nothing for a tree whose skills are committed', () => {
    write('README.md', 'changed outside the skills\n');

    expect(collectSkillChanges(repository)).toEqual({ skills: [], fingerprint: undefined });
  });

  it('reports a modified skill, and a new fingerprint for every further edit', () => {
    write(skillFile, '# demo\nfirst edit\n');

    const first = collectSkillChanges(repository);

    expect(first.skills).toEqual(['demo-skill']);
    expect(first.fingerprint).toEqual(expect.any(String));
    // Re-reading an unchanged tree is the same state: a reminder must not repeat for it.
    expect(collectSkillChanges(repository).fingerprint).toBe(first.fingerprint);

    write(skillFile, '# demo\nsecond edit\n');

    expect(collectSkillChanges(repository).fingerprint).not.toBe(first.fingerprint);
  });

  it('reports an untracked skill, which is how a new one arrives', () => {
    write(join('.claude', 'skills', 'new-skill', 'SKILL.md'), '# new\n');

    expect(collectSkillChanges(repository).skills).toEqual(['new-skill']);
  });

  it('reports a deleted skill file', () => {
    git(repository, 'rm', '-q', skillFile);

    expect(collectSkillChanges(repository).skills).toEqual(['demo-skill']);
  });

  it('reports nothing where git cannot answer, so a hook never blocks on a broken checkout', () => {
    const notARepository = mkdtempSync(join(tmpdir(), 'skill-evals-no-git-'));

    try {
      expect(collectSkillChanges(notARepository)).toEqual({ skills: [], fingerprint: undefined });
    } finally {
      rmSync(notARepository, { force: true, recursive: true });
    }
  });
});

describe('stopDecision', () => {
  const changes = { skills: ['creating-workflows'], fingerprint: 'abc' };

  it('blocks once for a state nothing has been said about yet', () => {
    const decision = stopDecision({ changes });

    expect(decision.block).toBe(true);
    expect(decision.fingerprint).toBe('abc');
    expect(decision.reason).toContain('pnpm skills:evals --case creating-workflows');
    expect(decision.reason).toContain('does not repeat');
  });

  it('stays silent at the state it already blocked on, so it cannot loop', () => {
    expect(stopDecision({ changes, previousFingerprint: 'abc' })).toEqual({
      block: false,
      fingerprint: 'abc',
    });
  });

  it('blocks again once the skill is edited further', () => {
    expect(
      stopDecision({ changes: { ...changes, fingerprint: 'def' }, previousFingerprint: 'abc' }),
    ).toMatchObject({ block: true, fingerprint: 'def' });
  });

  it('stays silent when no skill changed', () => {
    expect(stopDecision({ changes: { skills: [], fingerprint: undefined } })).toEqual({
      block: false,
    });
  });

  it('stays silent while a stop hook is already holding the turn open', () => {
    expect(stopDecision({ changes, stopHookActive: true })).toEqual({ block: false });
  });
});
