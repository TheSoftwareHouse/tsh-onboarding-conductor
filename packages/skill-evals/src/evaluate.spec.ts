import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ARTIFACT_CONTENT_LIMIT_BYTES,
  TOOL_TARGET_LIMIT_CHARS,
  buildAgentPrompt,
  collectArtifacts,
  prepareSandbox,
  resolveAgentModel,
  resolveSkillsUsed,
  summarizeToolUses,
} from './evaluate';
import type { GoldenCase, GoldenSet } from './golden-set';

const set: GoldenSet = { skill: 'alpha', directory: '/tmp/evals', cases: [] };
const baseCase: GoldenCase = {
  id: 'c',
  prompt: 'Do the thing.',
  invocation: 'explicit',
  expectedOutput: 'e',
  files: [],
  checks: [{ type: 'files-changed', glob: '**', status: 'any', min: 0, max: 0 }],
  assertions: [],
  threshold: 70,
  judge: true,
};

describe('buildAgentPrompt', () => {
  it('prefixes the skill for an explicit invocation and sends a natural prompt bare', () => {
    expect(buildAgentPrompt(set, baseCase)).toBe('/alpha Do the thing.');
    expect(buildAgentPrompt(set, { ...baseCase, invocation: 'natural' })).toBe('Do the thing.');
  });
});

describe('resolveAgentModel', () => {
  it('prefers the override, then the case, then the default', () => {
    expect(resolveAgentModel(baseCase, { agentModel: 'haiku' })).toBe('haiku');
    expect(resolveAgentModel({ ...baseCase, model: 'sonnet' }, { agentModel: 'haiku' })).toBe(
      'sonnet',
    );
    expect(
      resolveAgentModel(
        { ...baseCase, model: 'sonnet' },
        { agentModel: 'haiku', overrideModel: 'opus' },
      ),
    ).toBe('opus');
  });
});

describe('resolveSkillsUsed', () => {
  it('counts an explicit invocation as fired only when the harness had discovered the skill', () => {
    expect(
      resolveSkillsUsed(set, baseCase, { skillsUsed: [], availableSkills: ['alpha', 'beta'] }),
    ).toEqual(['alpha']);
    expect(
      resolveSkillsUsed(set, baseCase, {
        skillsUsed: ['beta', 'alpha'],
        availableSkills: ['alpha'],
      }),
    ).toEqual(['alpha', 'beta']);
    expect(resolveSkillsUsed(set, baseCase, { skillsUsed: [], availableSkills: [] })).toEqual([]);
  });

  it('reports exactly what the Skill tool invoked for a natural prompt', () => {
    expect(
      resolveSkillsUsed(
        set,
        { ...baseCase, invocation: 'natural' },
        { skillsUsed: ['beta'], availableSkills: ['alpha'] },
      ),
    ).toEqual(['beta']);
  });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@invalid', ...args], {
    cwd,
    stdio: 'pipe',
  }).toString();

describe('prepareSandbox', () => {
  let sandbox: string;
  let evals: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'skill-evals-prepare-'));
    evals = mkdtempSync(join(tmpdir(), 'skill-evals-prepare-evals-'));
    mkdirSync(join(sandbox, '.claude', 'skills', 'alpha', 'evals'), { recursive: true });
    writeFileSync(join(sandbox, '.claude', 'skills', 'alpha', 'evals', 'evals.json'), '{}');
    writeFileSync(join(sandbox, '.claude', 'skills', 'alpha', 'SKILL.md'), '# alpha');
    mkdirSync(join(evals, 'files'));
    writeFileSync(join(evals, 'files', 'input.json'), '{"broken":true}');
    git(sandbox, 'init', '-q');
    git(sandbox, 'add', '-A');
    git(sandbox, 'commit', '-q', '--no-verify', '-m', 'baseline');
  });

  afterEach(() => {
    rmSync(sandbox, { force: true, recursive: true });
    rmSync(evals, { force: true, recursive: true });
  });

  it('removes every golden set, copies the inputs in, leaves the tree clean and returns the baseline', async () => {
    const set: GoldenSet = { skill: 'alpha', directory: evals, cases: [] };
    const testCase: GoldenCase = {
      id: 'c',
      prompt: 'p',
      invocation: 'explicit',
      expectedOutput: 'e',
      files: [{ from: 'files/input.json', to: 'workflows/users/input.json' }],
      checks: [{ type: 'skill-fired', skill: 'alpha', expected: true }],
      assertions: [],
      threshold: 70,
      judge: true,
    };

    const baseline = await prepareSandbox(sandbox, set, testCase);

    expect(baseline).toMatch(/^[0-9a-f]{40}$/);
    expect(git(sandbox, 'rev-parse', 'HEAD').trim()).toBe(baseline);
    expect(() =>
      readFileSync(join(sandbox, '.claude', 'skills', 'alpha', 'evals', 'evals.json')),
    ).toThrow();
    expect(readFileSync(join(sandbox, '.claude', 'skills', 'alpha', 'SKILL.md'), 'utf8')).toBe(
      '# alpha',
    );
    expect(readFileSync(join(sandbox, 'workflows', 'users', 'input.json'), 'utf8')).toBe(
      '{"broken":true}',
    );
    expect(git(sandbox, 'status', '--porcelain')).toBe('');
  });
});

describe('collectArtifacts', () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'skill-evals-artifacts-'));
    writeFileSync(join(sandbox, 'text.json'), '{"a":1}');
    writeFileSync(join(sandbox, 'binary.bin'), Buffer.from([0, 1, 2, 3]));
    writeFileSync(join(sandbox, 'large.txt'), 'x'.repeat(ARTIFACT_CONTENT_LIMIT_BYTES + 10));
  });

  afterEach(() => {
    rmSync(sandbox, { force: true, recursive: true });
  });

  it('carries text content, omits binaries, truncates large files and marks deletions', () => {
    const artifacts = collectArtifacts(sandbox, [
      { status: '??', path: 'text.json' },
      { status: 'M', path: 'binary.bin' },
      { status: '??', path: 'large.txt' },
      { status: 'D', path: 'gone.md' },
    ]);

    expect(artifacts).toEqual([
      { path: 'text.json', status: 'added', content: '{"a":1}', truncated: false },
      { path: 'binary.bin', status: 'modified', truncated: true },
      {
        path: 'large.txt',
        status: 'added',
        content: 'x'.repeat(ARTIFACT_CONTENT_LIMIT_BYTES),
        truncated: true,
      },
      { path: 'gone.md', status: 'deleted', truncated: false },
    ]);
  });
});

describe('summarizeToolUses', () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'skill-evals-tools-'));
  });

  afterEach(() => {
    rmSync(sandbox, { force: true, recursive: true });
  });

  it('names the file, command or query each call was aimed at, with paths relative to the sandbox', () => {
    expect(
      summarizeToolUses(
        [
          {
            name: 'Write',
            input: { file_path: join(sandbox, 'workflows', 'x.json'), content: '{}' },
          },
          { name: 'Read', input: { file_path: join(realpathSync(sandbox), 'README.md') } },
          {
            name: 'Edit',
            input: { file_path: '/elsewhere/README.md', old_string: 'a', new_string: 'b' },
          },
          { name: 'Bash', input: { command: 'git   add -A &&\n git commit -m "publish"' } },
          { name: 'Grep', input: { pattern: 'version', path: sandbox } },
          { name: 'Glob', input: { path: join(sandbox, 'workflows') } },
          { name: 'Skill', input: { skill: 'creating-workflows' } },
          { name: 'TodoWrite', input: { todos: [] } },
          { name: 'Bash', input: { command: 'x'.repeat(TOOL_TARGET_LIMIT_CHARS + 5) } },
          { name: 'Task' },
        ],
        sandbox,
      ),
    ).toEqual([
      { name: 'Write', target: join('workflows', 'x.json') },
      { name: 'Read', target: 'README.md' },
      { name: 'Edit', target: '/elsewhere/README.md (outside the sandbox)' },
      { name: 'Bash', target: 'git add -A && git commit -m "publish"' },
      { name: 'Grep', target: 'version' },
      { name: 'Glob', target: 'workflows' },
      { name: 'Skill', target: 'creating-workflows' },
      { name: 'TodoWrite' },
      { name: 'Bash', target: `${'x'.repeat(TOOL_TARGET_LIMIT_CHARS)}…` },
      { name: 'Task' },
    ]);
  });
});
