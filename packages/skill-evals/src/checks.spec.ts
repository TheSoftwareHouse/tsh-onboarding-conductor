import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { type CheckContext, changeStatusOf, loadDdl, runCheck } from './checks';
import { REPO_ROOT } from './runner';

const BASE = join(REPO_ROOT, 'workflows', 'fixtures', 'base.workflow.json');

// The graph check compares step types, so its documents are written in specialized steps: every
// checked-in fixture is `custom` steps, which all compile to the same node type.
const TYPED_FLOW = {
  id: 'typed-flow',
  version: 1,
  initial: 'collect_email',
  steps: [
    {
      name: 'collect_email',
      type: 'connector-call',
      config: {
        connectors: [
          {
            name: 'mock_kyc_1',
            id: 'mock_kyc_1',
            type: 'kyc',
            order: 1,
            fieldMapping: { email: 'email' },
          },
        ],
      },
      include: [{ type: 'contact-details', config: { phoneNumber: 'omitted' } }],
      edges: { success: 'approved' },
    },
    { name: 'approved', type: 'terminal', config: { outcome: 'approved' } },
  ],
};
const TYPED_REVIEW = {
  id: 'typed-review',
  version: 1,
  initial: 'review',
  steps: [
    { name: 'review', type: 'manual-review', edges: { approve: 'approved', reject: 'rejected' } },
    { name: 'approved', type: 'terminal', config: { outcome: 'approved' } },
    { name: 'rejected', type: 'terminal', config: { outcome: 'rejected' } },
  ],
};

describe('checks', () => {
  let sandbox: string;
  let evalsDirectory: string;
  const ddl = loadDdl();

  const write = (root: string, path: string, contents: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  };

  const context = (overrides: Partial<CheckContext> = {}): CheckContext => ({
    sandbox,
    changedFiles: [],
    skillsUsed: [],
    toolNames: [],
    mcpServers: [],
    resultText: '',
    evalsDirectory,
    ddl: () => ddl,
    ...overrides,
  });

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'skill-evals-sandbox-'));
    evalsDirectory = mkdtempSync(join(tmpdir(), 'skill-evals-evals-'));
  });

  afterEach(() => {
    rmSync(sandbox, { force: true, recursive: true });
    rmSync(evalsDirectory, { force: true, recursive: true });
  });

  it('folds git statuses into added, modified and deleted', () => {
    expect(changeStatusOf({ status: '??', path: 'a' })).toBe('added');
    expect(changeStatusOf({ status: 'A', path: 'a' })).toBe('added');
    expect(changeStatusOf({ status: 'M', path: 'a' })).toBe('modified');
    expect(changeStatusOf({ status: 'D', path: 'a' })).toBe('deleted');
  });

  it('skill-fired compares against the skills the run invoked', () => {
    const fired = context({ skillsUsed: ['creating-workflows'] });

    expect(
      runCheck({ type: 'skill-fired', skill: 'creating-workflows', expected: true }, fired).passed,
    ).toBe(true);
    expect(
      runCheck({ type: 'skill-fired', skill: 'creating-workflows', expected: false }, fired).passed,
    ).toBe(false);
    expect(runCheck({ type: 'skill-fired', skill: 'other', expected: false }, fired)).toMatchObject(
      {
        passed: true,
        detail: expect.stringContaining('did not fire'),
      },
    );
  });

  it('skill-fired recognises a plugin skill under its namespace as well as bare', () => {
    const fired = context({ skillsUsed: ['conductor-analyst:investigating-onboarding'] });

    expect(
      runCheck({ type: 'skill-fired', skill: 'investigating-onboarding', expected: true }, fired)
        .passed,
    ).toBe(true);
    expect(
      runCheck(
        {
          type: 'skill-fired',
          skill: 'conductor-analyst:investigating-onboarding',
          expected: true,
        },
        fired,
      ).passed,
    ).toBe(true);
    // A bare name is not a suffix match on a word: `onboarding` is not `investigating-onboarding`.
    expect(
      runCheck({ type: 'skill-fired', skill: 'onboarding', expected: true }, fired).passed,
    ).toBe(false);
    expect(
      runCheck(
        { type: 'skill-fired', skill: 'other-plugin:investigating-onboarding', expected: true },
        fired,
      ).passed,
    ).toBe(false);
  });

  describe('mcp-tool-called', () => {
    const check = { type: 'mcp-tool-called', tool: 'get_onboarding', min: 1 } as const;

    it('counts the calls of the tool on the set servers and honours the minimum', () => {
      const called = context({
        mcpServers: ['conductor'],
        toolNames: [
          'Read',
          'mcp__conductor__get_onboarding',
          'mcp__conductor__get_onboarding',
          'mcp__conductor__list_onboardings',
        ],
      });

      expect(runCheck(check, called)).toMatchObject({
        passed: true,
        detail: expect.stringContaining('called 2 time(s) on server conductor'),
      });
      expect(runCheck({ ...check, min: 2 }, called).passed).toBe(true);
      expect(runCheck({ ...check, min: 3 }, called).passed).toBe(false);
    });

    it('fails, naming what was called instead, when the tool was not', () => {
      const result = runCheck(
        check,
        context({
          mcpServers: ['conductor'],
          toolNames: ['Bash', 'mcp__conductor__list_onboardings'],
        }),
      );

      expect(result.passed).toBe(false);
      expect(result.detail).toContain('called 0 time(s)');
      expect(result.detail).toContain('mcp__conductor__list_onboardings');
      expect(
        runCheck(check, context({ mcpServers: ['conductor'], toolNames: ['Bash'] })).detail,
      ).toContain('no MCP tool was called');
    });

    it('does not take a tool of the same name on a server the set did not declare', () => {
      expect(
        runCheck(
          check,
          context({ mcpServers: ['conductor'], toolNames: ['mcp__other__get_onboarding'] }),
        ).passed,
      ).toBe(false);
    });

    it('matches the server name as the harness spells it', () => {
      expect(
        runCheck(
          check,
          context({
            mcpServers: ['conductor mcp.v1'],
            toolNames: ['mcp__conductor_mcp_v1__get_onboarding'],
          }),
        ).passed,
      ).toBe(true);
    });

    it('accepts any server when the set declares none, but never a non-MCP tool of that name', () => {
      expect(
        runCheck(check, context({ toolNames: ['mcp__anything__get_onboarding'] })).passed,
      ).toBe(true);
      expect(runCheck(check, context({ toolNames: ['get_onboarding'] })).passed).toBe(false);
      expect(runCheck(check, context({ toolNames: ['mcp____get_onboarding'] })).passed).toBe(false);
      expect(runCheck(check, context({ toolNames: ['mcp__x__other_get_onboarding'] })).passed).toBe(
        false,
      );
    });
  });

  it('files-changed counts matching files of the wanted status within the bounds', () => {
    const changed = context({
      changedFiles: [
        { status: '??', path: 'workflows/fixtures/new.workflow.json' },
        { status: 'M', path: 'workflows/built-in/old.workflow.json' },
        { status: 'M', path: 'docs/IMPLEMENTATION.md' },
      ],
    });

    expect(
      runCheck(
        {
          type: 'files-changed',
          glob: 'workflows/fixtures/*.json',
          status: 'added',
          min: 1,
          max: 1,
        },
        changed,
      ).passed,
    ).toBe(true);
    expect(
      runCheck(
        {
          type: 'files-changed',
          glob: 'workflows/{built-in,fixtures}/*.json',
          status: 'modified',
          min: 0,
          max: 0,
        },
        changed,
      ),
    ).toMatchObject({
      passed: false,
      detail: expect.stringContaining('old.workflow.json'),
    });
    expect(
      runCheck({ type: 'files-changed', glob: '**', status: 'any', min: 0, max: 3 }, changed)
        .passed,
    ).toBe(true);
    expect(
      runCheck({ type: 'files-changed', glob: '**', status: 'any', min: 0, max: 2 }, changed)
        .passed,
    ).toBe(false);
  });

  it('answer-matches tests the final answer, with the expectation invertible', () => {
    const answered = context({ resultText: 'Map DOCUMENT_UPLOAD_CONFLICT to a re-reserve.' });

    expect(
      runCheck(
        { type: 'answer-matches', pattern: 'document_upload_conflict', flags: 'i', expected: true },
        answered,
      ).passed,
    ).toBe(true);
    expect(
      runCheck({ type: 'answer-matches', pattern: 'retry', flags: '', expected: false }, answered)
        .passed,
    ).toBe(true);
    expect(
      runCheck({ type: 'answer-matches', pattern: 'retry', flags: '', expected: true }, answered)
        .passed,
    ).toBe(false);
  });

  it('workflow-compiles runs the DDL over every matching changed file', () => {
    write(sandbox, 'workflows/users/good.workflow.json', readFileSync(BASE, 'utf8'));
    write(
      sandbox,
      'workflows/users/bad.workflow.json',
      JSON.stringify({ id: 'bad', version: 1, steps: [{ name: 'x' }] }),
    );
    write(sandbox, 'workflows/users/broken.json', '{ not json');

    const changed = (path: string) => context({ changedFiles: [{ status: '??', path }] });

    expect(
      runCheck(
        { type: 'workflow-compiles', glob: 'workflows/users/good.workflow.json' },
        changed('workflows/users/good.workflow.json'),
      ),
    ).toMatchObject({
      passed: true,
      detail: expect.stringContaining('compile and validate'),
    });
    expect(
      runCheck(
        { type: 'workflow-compiles', glob: 'workflows/users/bad.workflow.json' },
        changed('workflows/users/bad.workflow.json'),
      ),
    ).toMatchObject({
      passed: false,
      detail: expect.stringContaining('WORKFLOW_INVALID INVALID_SHAPE'),
    });
    expect(
      runCheck(
        { type: 'workflow-compiles', glob: 'workflows/users/broken.json' },
        changed('workflows/users/broken.json'),
      ),
    ).toMatchObject({
      passed: false,
      detail: expect.stringContaining('not JSON'),
    });
    expect(
      runCheck({ type: 'workflow-compiles', glob: 'workflows/users/*.json' }, context()),
    ).toMatchObject({
      passed: false,
      detail: expect.stringContaining('no changed file matches'),
    });
  });

  it('workflow-revision reads id and version off every matching file', () => {
    write(
      sandbox,
      'workflows/built-in/flow-v3.workflow.json',
      JSON.stringify({ id: 'flow', version: 3 }),
    );

    const changed = context({
      changedFiles: [{ status: '??', path: 'workflows/built-in/flow-v3.workflow.json' }],
    });

    expect(
      runCheck(
        { type: 'workflow-revision', glob: 'workflows/built-in/*.json', id: 'flow', version: 3 },
        changed,
      ).passed,
    ).toBe(true);
    expect(
      runCheck(
        { type: 'workflow-revision', glob: 'workflows/built-in/*.json', id: 'flow', version: 2 },
        changed,
      ),
    ).toMatchObject({
      passed: false,
      detail: expect.stringContaining('flow@3'),
    });
  });

  it('compiled-graph-matches compares the compiled shape against the golden, ignoring names', () => {
    const renamed = structuredClone(TYPED_FLOW);

    renamed.id = 'renamed';
    renamed.initial = 'ask_email';
    renamed.steps[0].name = 'ask_email';
    renamed.steps[0].edges = { success: 'done' };
    renamed.steps[1].name = 'done';

    write(sandbox, 'workflows/users/renamed.workflow.json', JSON.stringify(renamed));
    write(evalsDirectory, 'golden/base.workflow.json', JSON.stringify(TYPED_FLOW));
    write(evalsDirectory, 'golden/review.workflow.json', JSON.stringify(TYPED_REVIEW));

    const changed = context({
      changedFiles: [{ status: '??', path: 'workflows/users/renamed.workflow.json' }],
    });

    expect(
      runCheck(
        {
          type: 'compiled-graph-matches',
          glob: 'workflows/users/*.json',
          golden: 'golden/base.workflow.json',
        },
        changed,
      ),
    ).toMatchObject({
      passed: true,
      detail: expect.stringContaining('has the golden graph'),
    });
    expect(
      runCheck(
        {
          type: 'compiled-graph-matches',
          glob: 'workflows/users/*.json',
          golden: 'golden/review.workflow.json',
        },
        changed,
      ),
    ).toMatchObject({
      passed: false,
      detail: expect.stringMatching(/missing: \[.*manual-review.*\] extra: \[.*connector-call.*\]/),
    });
  });
});
