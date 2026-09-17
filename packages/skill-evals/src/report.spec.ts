import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RunResult } from './evaluate';
import type { GoldenCase, GoldenSet } from './golden-set';
import {
  ANSWER_REPORT_LIMIT_CHARS,
  TOOL_CALLS_REPORT_LIMIT,
  buildReport,
  renderConsoleLine,
  renderFailureLines,
  renderHeartbeat,
  renderMarkdown,
  renderStartLine,
  renderSummaryLine,
  summarizeCase,
  summarizeToolCalls,
  writeStepSummary,
} from './report';

const set: GoldenSet = { skill: 'creating-things', directory: '/tmp/evals', cases: [] };
const testCase: GoldenCase = {
  id: 'first-case',
  prompt: 'Do the thing.',
  invocation: 'explicit',
  expectedOutput: 'Done.',
  files: [],
  checks: [{ type: 'skill-fired', skill: 'creating-things', expected: true }],
  assertions: [],
  threshold: 70,
  judge: true,
};
const reportOptions = {
  agentModel: 'haiku',
  judgeModel: 'haiku',
  runsPerCase: 1,
  minPassRate: 0.5,
  environment: 'ANTHROPIC_API_KEY',
};

const run = (overrides: Partial<RunResult>): RunResult => ({
  runIndex: 0,
  agentModel: 'haiku',
  passed: true,
  errored: false,
  costUsd: 0.5,
  judgeCostUsd: 0.01,
  costEstimated: false,
  durationMs: 12_000,
  skillsUsed: ['creating-things'],
  changedFiles: [],
  checks: [
    {
      check: { type: 'skill-fired', skill: 'creating-things', expected: true },
      passed: true,
      detail: 'creating-things fired',
    },
  ],
  scorePassed: true,
  assertionsPassed: true,
  answer: 'Done.',
  toolUses: [],
  ...overrides,
});

describe('summarizeCase', () => {
  it('excludes errored runs from the pass rate and applies the minimum', () => {
    const summary = summarizeCase(
      set,
      testCase,
      [
        run({}),
        run({ runIndex: 1, passed: false }),
        run({ runIndex: 2, errored: true, passed: false, failure: 'timeout' }),
      ],
      0.5,
    );

    expect(summary).toMatchObject({ graded: 2, passedRuns: 1, passRate: 0.5, passed: true });
    expect(summarizeCase(set, testCase, summary.runs, 0.75).passed).toBe(false);
  });

  it('fails a case none of whose runs could be graded', () => {
    expect(
      summarizeCase(set, testCase, [run({ errored: true, passed: false })], 0.5),
    ).toMatchObject({
      graded: 0,
      passRate: 0,
      passed: false,
    });
  });
});

describe('buildReport and renderMarkdown', () => {
  it('totals cost across agent and judge and renders every run with its checks and verdicts', () => {
    const summary = summarizeCase(
      set,
      testCase,
      [
        run({
          judgement: {
            score: 88,
            reasoning: 'solid',
            assertions: [{ text: 'names it', severity: 'error', passed: true, evidence: 'line 3' }],
          },
        }),
        run({
          runIndex: 1,
          errored: true,
          passed: false,
          failure: 'the harness produced no result',
          sandbox: '/tmp/kept',
          costEstimated: true,
        }),
      ],
      0.5,
    );
    const report = buildReport([summary], {
      ...reportOptions,
      runsPerCase: 2,
      now: new Date('2026-09-17T12:00:00Z'),
    });

    expect(report.totals).toEqual({
      cases: 1,
      passedCases: 1,
      runs: 2,
      erroredRuns: 1,
      costUsd: 1.02,
      costEstimated: true,
    });

    const markdown = renderMarkdown(report);

    expect(markdown).toContain('1/1 cases passed');
    expect(markdown).toContain(
      '| creating-things/first-case | haiku | explicit | pass | 1/1 (+1 errored) | 70 |',
    );
    expect(markdown).toContain('ok   `skill-fired` — creating-things fired');
    expect(markdown).toContain('judge score 88 (meets threshold): solid');
    expect(markdown).toContain('PASS names it — line 3');
    expect(markdown).toContain(
      '**error** — the harness produced no result (sandbox kept at `/tmp/kept`)',
    );
    expect(summary.agentModel).toBe('haiku');
    expect(renderConsoleLine(summary)).toBe(
      `ok    ${'creating-things/first-case'.padEnd(48)} 1/1 run(s) passed on haiku, 1 errored`,
    );
  });
});

describe('failure diagnostics', () => {
  const v3 = 'workflows/built-in/eu-b2c-individual-kyc-eea.v3.workflow.json';
  const failed = run({
    passed: false,
    checks: [
      {
        check: {
          type: 'files-changed',
          glob: 'workflows/built-in/*.workflow.json',
          status: 'added',
          min: 1,
          max: 1,
        },
        passed: false,
        detail: '0 added file(s) match workflows/built-in/*.workflow.json, expected 1-1: none',
      },
    ],
    judgement: {
      score: 5,
      reasoning: 'The agent claims to have added a file but no file evidence exists.',
      assertions: [
        {
          text: 'The new revision exists',
          severity: 'error',
          passed: false,
          evidence: 'No workflow file provided.',
        },
        {
          text: 'docs mention it',
          severity: 'warn',
          passed: false,
          evidence: 'No documentation file provided.',
        },
      ],
    },
    scorePassed: false,
    assertionsPassed: false,
    answer: `I created ${v3} and committed it.`,
    toolUses: [
      { name: 'Read', target: 'workflows/built-in/eu-b2c-individual-kyc-eea.v2.workflow.json' },
      { name: 'Write', target: v3 },
      { name: 'Edit', target: 'docs/IMPLEMENTATION.md' },
      { name: 'Bash', target: 'git add -A && git commit -m "publish v3"' },
      { name: 'TodoWrite' },
    ],
    harness: { exitCode: 0, resultSubtype: 'success', numTurns: 23 },
  });
  const toolCalls = `Read ×1, Write ×1 → ${v3}, Edit ×1 → docs/IMPLEMENTATION.md, Bash ×1, TodoWrite ×1`;
  const summary = summarizeCase(set, testCase, [failed], 0.5);
  const markdown = renderMarkdown(buildReport([summary], reportOptions));

  it('summarizes the tool calls with the files the writing tools were aimed at', () => {
    expect(summarizeToolCalls([])).toBe('none');
    expect(summarizeToolCalls(failed.toolUses)).toBe(toolCalls);
    expect(
      summarizeToolCalls(
        ['a', 'b', 'c', 'd', 'e'].map((name) => ({ name: 'Write', target: `${name}.json` })),
      ),
    ).toBe('Write ×5 → a.json, b.json, c.json and 2 more');
  });

  it('lists what a failed run changed and called, and folds the whole record under the verdict', () => {
    expect(markdown).toContain('  - files changed: none');
    expect(markdown).toContain(`  - tool calls: ${toolCalls}`);
    expect(markdown).toContain('<details><summary>Run 1: what the agent did</summary>');
    expect(markdown).toContain('**Tool calls** (5):');
    expect(markdown).toContain(`- \`Write\` \`${v3}\``);
    expect(markdown).toContain('- `Bash` `git add -A && git commit -m "publish v3"`');
    expect(markdown).toContain('- `TodoWrite`\n');
    expect(markdown).toContain(
      `**Agent's final message:**\n\n\`\`\`\nI created ${v3} and committed it.\n\`\`\``,
    );
    expect(markdown).toContain('**Harness:** exit code 0, result "success", 23 turn(s).');
  });

  it('keeps a passing run to its verdict and the files it changed', () => {
    const passing = renderMarkdown(
      buildReport(
        [summarizeCase(set, testCase, [run({ changedFiles: ['a.json'] })], 0.5)],
        reportOptions,
      ),
    );

    expect(passing).toContain('  - files changed: `a.json`');
    expect(passing).not.toContain('tool calls:');
    expect(passing).not.toContain('<details>');
  });

  it('prints the reasons under the console line, one per line', () => {
    expect(renderFailureLines(summary)).toEqual([
      '      run 1: FAIL files-changed — 0 added file(s) match workflows/built-in/*.workflow.json, expected 1-1: none',
      '      run 1: judge score 5 below threshold 70 — The agent claims to have added a file but no file evidence exists.',
      '      run 1: FAIL The new revision exists — No workflow file provided.',
      `      run 1: files changed: none; tool calls: ${toolCalls}`,
    ]);
    expect(renderFailureLines(summarizeCase(set, testCase, [run({})], 0.5))).toEqual([]);
  });

  it('shortens a long final message and counts the tool calls past the limit', () => {
    const long = run({
      passed: false,
      answer: 'a'.repeat(ANSWER_REPORT_LIMIT_CHARS + 1),
      toolUses: Array.from({ length: TOOL_CALLS_REPORT_LIMIT + 2 }, () => ({
        name: 'Read',
        target: 'x',
      })),
    });
    const rendered = renderMarkdown(
      buildReport([summarizeCase(set, testCase, [long], 0.5)], reportOptions),
    );

    expect(rendered).toContain(`${'a'.repeat(ANSWER_REPORT_LIMIT_CHARS)}…`);
    expect(rendered).toContain('(truncated; `report.json` has the whole message)');
    expect(rendered).toContain(`- … 2 more`);
  });

  it('describes an errored run by what it left behind and what the harness said', () => {
    const errored = run({
      errored: true,
      passed: false,
      failure: 'the run was killed at its time cap of 15 min',
      sandbox: '/tmp/kept',
      changedFiles: ['workflows/users/draft.workflow.json'],
      toolUses: [{ name: 'Write', target: 'workflows/users/draft.workflow.json' }],
      harness: { exitCode: null, stderr: 'boom' },
    });
    const erroredSummary = summarizeCase(set, testCase, [errored], 0.5);
    const rendered = renderMarkdown(buildReport([erroredSummary], reportOptions));

    expect(rendered).toContain(
      [
        '- run 1: **error** — the run was killed at its time cap of 15 min (sandbox kept at `/tmp/kept`)',
        '  - files changed: `workflows/users/draft.workflow.json`',
        '  - tool calls: Write ×1 → workflows/users/draft.workflow.json',
      ].join('\n'),
    );
    expect(rendered).toContain('**Harness:** exit code none.');
    expect(rendered).toContain('**Harness stderr (tail):**\n\n```\nboom\n```');
    expect(renderFailureLines(erroredSummary)).toEqual([
      '      run 1: error — the run was killed at its time cap of 15 min; sandbox kept at /tmp/kept',
      '      run 1: files changed: workflows/users/draft.workflow.json; tool calls: Write ×1 → workflows/users/draft.workflow.json',
    ]);
  });
});

describe('progress output', () => {
  it('announces a run when it starts and names what is still in flight once a minute', () => {
    expect(renderStartLine('creating-things/first-case', 1, 3, 'sonnet')).toBe(
      `run   ${'creating-things/first-case'.padEnd(48)} run 2/3 started on sonnet`,
    );
    expect(
      renderHeartbeat(
        [
          { name: 'creating-things/first-case', agentModel: 'sonnet', startedAt: 0 },
          { name: 'creating-things/second-case', agentModel: 'haiku', startedAt: 150_000 },
        ],
        240_000,
      ),
    ).toBe(
      '...   still running: creating-things/first-case (4 min on sonnet), creating-things/second-case (1 min on haiku)',
    );
  });
});

describe('partial reports', () => {
  it('marks a report that stopped short of its plan as partial, with the runs it was waiting on', () => {
    const summary = summarizeCase(set, testCase, [run({})], 0.5);
    const report = buildReport([summary], {
      ...reportOptions,
      plannedCases: 3,
      interrupted: ['creating-things/second-case'],
    });

    expect(report.complete).toBe(false);
    expect(renderMarkdown(report)).toContain(
      '**Partial report: 1 of 3 planned case(s) finished, 1 passed; stopped while running creating-things/second-case.**',
    );
    expect(renderMarkdown(report)).toContain('1/1 finished cases passed.');
    expect(renderSummaryLine(report)).toBe(
      'Partial: 1 of 3 planned case(s) finished, 1 passed; stopped while running creating-things/second-case. Spent $0.51.',
    );
  });

  it('is partial while cases are still to come, and complete once every planned case is in', () => {
    const summary = summarizeCase(set, testCase, [run({})], 0.5);
    const inProgress = buildReport([summary], { ...reportOptions, plannedCases: 2 });
    const complete = buildReport([summary], reportOptions);

    expect(inProgress.complete).toBe(false);
    expect(renderSummaryLine(inProgress)).toBe(
      'Partial: 1 of 2 planned case(s) finished, 1 passed. Spent $0.51.',
    );
    expect(complete.complete).toBe(true);
    expect(renderMarkdown(complete)).not.toContain('Partial report');
    expect(renderSummaryLine(complete)).toBe('1/1 cases passed. Spent $0.51.');
  });
});

describe('writeStepSummary', () => {
  it('replaces the summary with the current report rather than appending to it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'skill-evals-summary-'));
    const path = join(directory, 'summary.md');

    try {
      const summary = summarizeCase(set, testCase, [run({})], 0.5);
      const partial = buildReport([summary], { ...reportOptions, plannedCases: 2 });
      const complete = buildReport([summary], reportOptions);

      writeStepSummary(path, partial);
      writeStepSummary(path, complete);

      expect(readFileSync(path, 'utf8')).toBe(`${renderMarkdown(complete)}\n`);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
