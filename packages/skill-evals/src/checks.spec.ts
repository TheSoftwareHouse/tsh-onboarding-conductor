import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { type CheckContext, changeStatusOf, loadDdl, runCheck } from './checks';
import { REPO_ROOT } from './runner';

const BASE_TYPED = join(REPO_ROOT, 'workflows', 'fixtures', 'base-typed.workflow.json');
const MANUAL_REVIEW_TYPED = join(
  REPO_ROOT,
  'workflows',
  'fixtures',
  'manual-review-typed.workflow.json',
);

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
    write(sandbox, 'workflows/users/good.workflow.json', readFileSync(BASE_TYPED, 'utf8'));
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
    const renamed = JSON.parse(readFileSync(BASE_TYPED, 'utf8'));

    renamed.id = 'renamed';
    renamed.initial = 'ask_email';
    renamed.steps[0].name = 'ask_email';
    renamed.steps[0].edges.success[0].target = 'agree';
    renamed.steps[1].name = 'agree';
    renamed.agreements[0].step = 'agree';

    write(sandbox, 'workflows/users/renamed.workflow.json', JSON.stringify(renamed));
    write(evalsDirectory, 'golden/base.workflow.json', readFileSync(BASE_TYPED, 'utf8'));
    write(evalsDirectory, 'golden/review.workflow.json', readFileSync(MANUAL_REVIEW_TYPED, 'utf8'));

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
