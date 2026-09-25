import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_THRESHOLD, loadGoldenSets, parseGoldenSet } from './golden-set';

const SKILL = 'creating-things';

describe('parseGoldenSet', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'skill-evals-golden-'));
    mkdirSync(join(directory, 'golden'));
    mkdirSync(join(directory, 'files'));
    writeFileSync(join(directory, 'golden', 'answer.md'), '# golden\n');
    writeFileSync(join(directory, 'files', 'input.json'), '{}\n');
  });

  afterEach(() => {
    rmSync(directory, { force: true, recursive: true });
  });

  const minimalCase = () => ({
    id: 'first-case',
    prompt: 'Do the thing.',
    expected_output: 'The thing is done.',
    checks: [{ type: 'skill-fired' }],
  });

  const parse = (raw: unknown) => parseGoldenSet(raw, { skill: SKILL, directory });

  it('parses a minimal set with defaults filled in', () => {
    const { set, problems } = parse({ skill_name: SKILL, evals: [minimalCase()] });

    expect(problems).toEqual([]);
    expect(set?.cases).toHaveLength(1);
    expect(set?.cases[0]).toMatchObject({
      id: 'first-case',
      invocation: 'explicit',
      threshold: DEFAULT_THRESHOLD,
      judge: true,
      files: [],
      assertions: [],
      checks: [{ type: 'skill-fired', skill: SKILL, expected: true }],
    });
  });

  it('refuses a skill_name that is not the directory it sits in', () => {
    const { problems } = parse({ skill_name: 'other', evals: [minimalCase()] });

    expect(problems.map((problem) => problem.at)).toContain(`${SKILL}/evals/evals.json.skill_name`);
  });

  it('fails on unknown keys at every level rather than ignoring them', () => {
    const { problems } = parse({
      skill_name: SKILL,
      extra: true,
      evals: [{ ...minimalCase(), asertions: [] }],
    });

    expect(problems.map((problem) => problem.message)).toEqual([
      expect.stringContaining('unknown key "extra"'),
      expect.stringContaining('unknown key "asertions"'),
    ]);
  });

  it('refuses duplicate case ids and ids outside the kebab-case grammar', () => {
    const { problems } = parse({
      skill_name: SKILL,
      evals: [minimalCase(), minimalCase(), { ...minimalCase(), id: 'Bad Id' }],
    });

    expect(problems).toEqual([
      expect.objectContaining({ message: expect.stringContaining('duplicates evals[0].id') }),
      expect.objectContaining({ at: expect.stringContaining('evals[2].id') }),
    ]);
  });

  it('reads the invocation and refuses a prompt that spells the skill prefix itself', () => {
    const natural = parse({
      skill_name: SKILL,
      evals: [{ ...minimalCase(), invocation: 'natural' }],
    });
    const unknown = parse({
      skill_name: SKILL,
      evals: [{ ...minimalCase(), invocation: 'slash' }],
    });
    const prefixed = parse({
      skill_name: SKILL,
      evals: [{ ...minimalCase(), prompt: '/creating-things do it' }],
    });

    expect(natural.set?.cases[0].invocation).toBe('natural');
    expect(unknown.problems[0]?.at).toContain('invocation');
    expect(prefixed.problems[0]?.message).toContain('must not start with a slash');
  });

  it('reads a model at set and case level, the case winning, and refuses one with whitespace', () => {
    const { set } = parse({
      skill_name: SKILL,
      model: 'sonnet',
      evals: [minimalCase(), { ...minimalCase(), id: 'second-case', model: 'opus' }],
    });
    const { problems } = parse({
      skill_name: SKILL,
      evals: [{ ...minimalCase(), model: 'claude opus' }],
    });

    expect(set?.cases.map((entry) => entry.model)).toEqual(['sonnet', 'opus']);
    expect(
      parse({ skill_name: SKILL, evals: [minimalCase()] }).set?.cases[0].model,
    ).toBeUndefined();
    expect(problems[0]?.at).toContain('model');
  });

  it('requires at least one deterministic check per case', () => {
    const { problems } = parse({ skill_name: SKILL, evals: [{ ...minimalCase(), checks: [] }] });

    expect(problems[0]?.message).toContain('non-empty list');
  });

  it('requires an expected output only when the case is judged', () => {
    const judged = parse({ skill_name: SKILL, evals: [{ ...minimalCase(), expected_output: '' }] });
    const unjudged = parse({
      skill_name: SKILL,
      evals: [{ ...minimalCase(), expected_output: undefined, judge: false }],
    });

    expect(judged.problems[0]?.at).toContain('expected_output');
    expect(unjudged.problems).toEqual([]);
  });

  it('refuses assertions on a case that disables the judge', () => {
    const { problems } = parse({
      skill_name: SKILL,
      evals: [{ ...minimalCase(), judge: false, assertions: ['x'] }],
    });

    expect(problems[0]?.message).toContain('disables');
  });

  it('reads assertions as strings or as { text, severity }', () => {
    const { set } = parse({
      skill_name: SKILL,
      evals: [{ ...minimalCase(), assertions: ['must', { text: 'should', severity: 'warn' }] }],
    });

    expect(set?.cases[0].assertions).toEqual([
      { text: 'must', severity: 'error' },
      { text: 'should', severity: 'warn' },
    ]);
  });

  it('applies the set threshold to cases that declare none and validates overrides', () => {
    const { set } = parse({
      skill_name: SKILL,
      threshold: 80,
      evals: [minimalCase(), { ...minimalCase(), id: 'second-case', threshold: 55 }],
    });
    const { problems } = parse({
      skill_name: SKILL,
      evals: [{ ...minimalCase(), threshold: 101 }],
    });

    expect(set?.cases.map((entry) => entry.threshold)).toEqual([80, 55]);
    expect(problems[0]?.message).toContain('between 0 and 100');
  });

  it('checks that golden and input paths exist inside the evals directory', () => {
    const { set, problems } = parse({
      skill_name: SKILL,
      evals: [
        {
          ...minimalCase(),
          golden: 'golden/answer.md',
          files: [{ from: 'files/input.json', to: 'workflows/users/input.json' }],
        },
      ],
    });
    const escaping = parse({
      skill_name: SKILL,
      evals: [
        {
          ...minimalCase(),
          golden: '../answer.md',
          files: [{ from: 'files/missing.json', to: '/etc/passwd' }],
        },
      ],
    });

    expect(problems).toEqual([]);
    expect(set?.cases[0].golden).toBe('golden/answer.md');
    expect(escaping.problems.map((problem) => problem.at)).toEqual([
      expect.stringContaining('golden'),
      expect.stringContaining('files[0].from'),
      expect.stringContaining('files[0].to'),
    ]);
  });

  describe('checks', () => {
    const withCheck = (check: unknown) =>
      parse({ skill_name: SKILL, evals: [{ ...minimalCase(), checks: [check] }] });

    it('rejects unknown types and unknown keys', () => {
      expect(withCheck({ type: 'nope' }).problems[0]?.message).toContain('unknown check type');
      expect(withCheck({ type: 'skill-fired', globb: '*' }).problems[0]?.message).toContain(
        'unknown key "globb"',
      );
    });

    it('validates files-changed bounds', () => {
      expect(withCheck({ type: 'files-changed', glob: '**' }).problems[0]?.message).toContain(
        'asserts nothing',
      );
      expect(
        withCheck({ type: 'files-changed', glob: '**', min: 2, max: 1 }).problems[0]?.message,
      ).toContain('exceed');
      expect(
        withCheck({ type: 'files-changed', glob: '**', status: 'renamed', max: 0 }).problems[0]?.at,
      ).toContain('status');
      expect(
        withCheck({ type: 'files-changed', glob: '**', max: 0 }).set?.cases[0].checks[0],
      ).toEqual({
        type: 'files-changed',
        glob: '**',
        status: 'any',
        min: 0,
        max: 0,
      });
    });

    it('validates answer-matches as a regular expression', () => {
      expect(withCheck({ type: 'answer-matches', pattern: '(' }).problems[0]?.message).toContain(
        'invalid RegExp',
      );
      expect(
        withCheck({ type: 'answer-matches', pattern: 'x', flags: 'i', expected: false }).set
          ?.cases[0].checks[0],
      ).toEqual({
        type: 'answer-matches',
        pattern: 'x',
        flags: 'i',
        expected: false,
      });
    });

    it('requires the golden of compiled-graph-matches to exist', () => {
      expect(
        withCheck({ type: 'compiled-graph-matches', glob: '*.json', golden: 'golden/none.json' })
          .problems[0]?.message,
      ).toContain('no such file');
      expect(
        withCheck({ type: 'compiled-graph-matches', glob: '*.json', golden: 'golden/answer.md' })
          .problems,
      ).toEqual([]);
    });

    it('validates workflow-revision', () => {
      expect(
        withCheck({ type: 'workflow-revision', glob: '*.json', id: 'x', version: 0 }).problems[0]
          ?.at,
      ).toContain('version');
      expect(
        withCheck({ type: 'workflow-revision', glob: '*.json', id: 'x', version: 2 }).problems,
      ).toEqual([]);
    });
  });
});

describe('loadGoldenSets', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'skill-evals-repo-'));
  });

  afterEach(() => {
    rmSync(repoRoot, { force: true, recursive: true });
  });

  const addSkill = (name: string, evals?: string) => {
    mkdirSync(join(repoRoot, '.claude', 'skills', name, 'evals'), { recursive: true });
    if (evals !== undefined) {
      writeFileSync(join(repoRoot, '.claude', 'skills', name, 'evals', 'evals.json'), evals);
    }
  };

  it('loads every skill that ships a set, reports the ones that do not, and surfaces bad JSON', () => {
    addSkill(
      'alpha',
      JSON.stringify({
        skill_name: 'alpha',
        evals: [
          { id: 'one', prompt: 'p', expected_output: 'e', checks: [{ type: 'skill-fired' }] },
        ],
      }),
    );
    addSkill('beta');
    addSkill('gamma', '{ not json');

    const loaded = loadGoldenSets(repoRoot);

    expect(loaded.sets.map((set) => set.skill)).toEqual(['alpha']);
    expect(loaded.sets[0].directory).toBe(join(repoRoot, '.claude', 'skills', 'alpha', 'evals'));
    expect(loaded.skillsWithoutEvals).toEqual(['beta']);
    expect(loaded.problems).toEqual([expect.objectContaining({ at: 'gamma/evals/evals.json' })]);
  });

  it('returns nothing for a repository without skills', () => {
    expect(loadGoldenSets(repoRoot)).toEqual({ sets: [], problems: [], skillsWithoutEvals: [] });
  });
});
