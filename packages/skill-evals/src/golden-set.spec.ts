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

  const parse = (raw: unknown) =>
    parseGoldenSet(raw, { skill: SKILL, directory, repoRoot: directory });

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

  it('accepts manifest placeholders and refuses a malformed one wherever it is written', () => {
    const placeholders = {
      ...minimalCase(),
      prompt: 'Why was {{manifest:score-reject-03}} rejected?',
      expected_output: '{{manifest:score-reject-03.explanation}}',
      assertions: ['Says {{manifest:score-reject-03.explanation}}'],
    };

    expect(parse({ skill_name: SKILL, evals: [placeholders] }).problems).toEqual([]);

    const { problems } = parse({
      skill_name: SKILL,
      evals: [
        {
          ...placeholders,
          prompt: 'Why was {{manifest:}} rejected?',
          expected_output: '{{manifest:a.id}}',
          assertions: ['{{manifest:a}', { text: '{{manifest:b c}}' }],
        },
      ],
    });

    expect(problems.map((problem) => problem.at)).toEqual([
      expect.stringContaining('.prompt'),
      expect.stringContaining('.expected_output'),
      expect.stringContaining('assertions[0]'),
      expect.stringContaining('assertions[1].text'),
    ]);
    expect(problems[0].message).toContain('malformed {{manifest:');
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

  describe('mcp_config', () => {
    let repoRoot: string;

    const mcpFile = (servers: unknown = { conductor: { type: 'http', url: 'http://x/mcp' } }) =>
      JSON.stringify({ mcpServers: servers });
    const parseWith = (mcpConfig: unknown, context: { plugin?: string } = {}) =>
      parseGoldenSet(
        { skill_name: SKILL, mcp_config: mcpConfig, evals: [minimalCase()] },
        { skill: SKILL, directory, repoRoot, ...context },
      );

    beforeEach(() => {
      repoRoot = mkdtempSync(join(tmpdir(), 'skill-evals-golden-repo-'));
    });

    afterEach(() => {
      rmSync(repoRoot, { force: true, recursive: true });
    });

    it('is optional and leaves a set without MCP servers', () => {
      expect(parse({ skill_name: SKILL, evals: [minimalCase()] }).set?.mcp).toBeUndefined();
    });

    it('resolves a path relative to the repository and reads the server names', () => {
      mkdirSync(join(repoRoot, 'plugins', 'analyst'), { recursive: true });
      writeFileSync(
        join(repoRoot, 'plugins', 'analyst', '.mcp.json'),
        mcpFile({ conductor: {}, audit: {} }),
      );

      const { set, problems } = parseWith('plugins/analyst/.mcp.json');

      expect(problems).toEqual([]);
      expect(set?.mcp).toEqual({
        file: join(repoRoot, 'plugins', 'analyst', '.mcp.json'),
        servers: ['conductor', 'audit'],
      });
    });

    it('prefers a path relative to the set over one relative to the repository', () => {
      writeFileSync(join(directory, 'files', 'mcp.json'), mcpFile({ local: {} }));
      mkdirSync(join(repoRoot, 'files'), { recursive: true });
      writeFileSync(join(repoRoot, 'files', 'mcp.json'), mcpFile({ shared: {} }));

      expect(parseWith('files/mcp.json').set?.mcp).toEqual({
        file: join(directory, 'files', 'mcp.json'),
        servers: ['local'],
      });
    });

    it('refuses a missing file, a path that escapes, a non-string and unparseable JSON', () => {
      writeFileSync(join(repoRoot, 'broken.json'), '{ nope');

      expect(parseWith('missing.json').problems[0]?.message).toContain('no such file');
      expect(parseWith('../outside.json').problems[0]?.message).toContain('relative path inside');
      expect(parseWith('/etc/mcp.json').problems[0]?.message).toContain('relative path inside');
      expect(parseWith(7).problems[0]?.message).toContain('relative path inside');
      expect(parseWith('broken.json').problems[0]?.message).toContain('unparseable JSON');
    });

    it('refuses a document that is not the { mcpServers } form or declares no server', () => {
      writeFileSync(join(repoRoot, 'bare.json'), JSON.stringify({ conductor: { type: 'http' } }));
      writeFileSync(join(repoRoot, 'empty.json'), mcpFile({}));

      expect(parseWith('bare.json').problems[0]?.message).toContain('{ "mcpServers"');
      expect(parseWith('empty.json').problems[0]?.message).toContain('declares no MCP server');
    });

    it('names a plugin set by its path in a problem and carries the plugin', () => {
      mkdirSync(join(repoRoot, 'plugins', 'analyst'), { recursive: true });
      writeFileSync(join(repoRoot, 'plugins', 'analyst', '.mcp.json'), mcpFile());

      expect(parseWith('plugins/analyst/.mcp.json', { plugin: 'analyst' }).set?.plugin).toBe(
        'analyst',
      );
      expect(parseWith('missing.json', { plugin: 'analyst' }).problems[0]?.at).toBe(
        `plugins/analyst/skills/${SKILL}/evals/evals.json.mcp_config`,
      );
    });
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

    it('validates mcp-tool-called: a bare tool name and a positive minimum', () => {
      expect(
        withCheck({ type: 'mcp-tool-called', tool: 'get_onboarding' }).set?.cases[0].checks[0],
      ).toEqual({
        type: 'mcp-tool-called',
        tool: 'get_onboarding',
        min: 1,
      });
      expect(
        withCheck({ type: 'mcp-tool-called', tool: 'get_onboarding', min: 3 }).set?.cases[0]
          .checks[0],
      ).toMatchObject({ min: 3 });
      expect(withCheck({ type: 'mcp-tool-called' }).problems[0]?.at).toContain('tool');
      expect(withCheck({ type: 'mcp-tool-called', tool: 'a b' }).problems[0]?.at).toContain('tool');
      expect(
        withCheck({ type: 'mcp-tool-called', tool: 'mcp__conductor__get_onboarding' }).problems[0]
          ?.message,
      ).toContain('tool name alone');
      expect(
        withCheck({ type: 'mcp-tool-called', tool: 'get_onboarding', min: 0 }).problems[0]?.at,
      ).toContain('min');
      expect(
        withCheck({ type: 'mcp-tool-called', tool: 'get_onboarding', server: 'x' }).problems[0]
          ?.message,
      ).toContain('unknown key "server"');
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

  const addPluginSkill = (plugin: string, skill: string, evals?: string) => {
    const evalsDirectory = join(repoRoot, 'plugins', plugin, 'skills', skill, 'evals');

    mkdirSync(evalsDirectory, { recursive: true });
    if (evals !== undefined) {
      writeFileSync(join(evalsDirectory, 'evals.json'), evals);
    }
  };
  const minimalSet = (skill: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      skill_name: skill,
      ...extra,
      evals: [{ id: 'one', prompt: 'p', expected_output: 'e', checks: [{ type: 'skill-fired' }] }],
    });

  it('loads the golden sets of plugin skills beside the repository ones', () => {
    addSkill('alpha', minimalSet('alpha'));
    addPluginSkill('analyst', 'investigating', minimalSet('investigating'));
    addPluginSkill('analyst', 'triaging');
    addPluginSkill('analyst', 'broken', '{ not json');

    const loaded = loadGoldenSets(repoRoot);

    expect(loaded.sets.map((set) => [set.skill, set.plugin])).toEqual([
      ['alpha', undefined],
      ['investigating', 'analyst'],
    ]);
    expect(loaded.sets[1].directory).toBe(
      join(repoRoot, 'plugins', 'analyst', 'skills', 'investigating', 'evals'),
    );
    expect(loaded.skillsWithoutEvals).toEqual(['analyst:triaging']);
    expect(loaded.problems).toEqual([
      expect.objectContaining({ at: 'plugins/analyst/skills/broken/evals/evals.json' }),
    ]);
  });

  it('requires a plugin skill_name to equal its directory, and reads its mcp_config from the repository', () => {
    writeFileSync(join(repoRoot, 'mcp.json'), JSON.stringify({ mcpServers: { conductor: {} } }));
    addPluginSkill(
      'analyst',
      'investigating',
      minimalSet('investigating', { mcp_config: 'mcp.json' }),
    );
    addPluginSkill('analyst', 'triaging', minimalSet('other'));

    const loaded = loadGoldenSets(repoRoot);

    expect(loaded.sets).toEqual([
      expect.objectContaining({
        skill: 'investigating',
        mcp: { file: join(repoRoot, 'mcp.json'), servers: ['conductor'] },
      }),
    ]);
    expect(loaded.problems).toEqual([
      expect.objectContaining({
        at: 'plugins/analyst/skills/triaging/evals/evals.json.skill_name',
      }),
    ]);
  });

  it('returns nothing for a repository without skills', () => {
    expect(loadGoldenSets(repoRoot)).toEqual({ sets: [], problems: [], skillsWithoutEvals: [] });
  });
});
