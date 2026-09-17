import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { RunResult, ToolUseSummary } from './evaluate';
import type { GoldenCase, GoldenSet, Invocation } from './golden-set';
import { fence, inlineCode } from './markdown';
import { formatUsd } from './runner';

export type CaseResult = {
  readonly skill: string;
  readonly id: string;
  readonly prompt: string;
  readonly invocation: Invocation;
  /** The agent model the case ran on (every run of a case uses the same one). */
  readonly agentModel: string;
  readonly threshold: number;
  readonly runs: readonly RunResult[];
  /** Runs that produced a verdict; errored runs are excluded rather than counted as failures. */
  readonly graded: number;
  readonly passedRuns: number;
  readonly passRate: number;
  readonly passed: boolean;
};

export type EvalReport = {
  readonly generatedAt: string;
  readonly agentModel: string;
  readonly judgeModel: string;
  readonly runsPerCase: number;
  readonly minPassRate: number;
  readonly environment: string;
  readonly cases: readonly CaseResult[];
  /** How many cases the run set out to grade; more than `cases.length` while it is still going. */
  readonly plannedCases: number;
  /** The runs that were in flight when the process was told to stop, as `skill/id`. */
  readonly interrupted: readonly string[];
  /** Every planned case finished and nothing was interrupted. */
  readonly complete: boolean;
  readonly totals: {
    readonly cases: number;
    readonly passedCases: number;
    readonly runs: number;
    readonly erroredRuns: number;
    readonly costUsd: number;
    readonly costEstimated: boolean;
  };
};

/** A run the console is waiting on. */
export type InFlightRun = {
  readonly name: string;
  readonly agentModel: string;
  readonly startedAt: number;
};

const CONSOLE_NAME_WIDTH = 48;
/** The reasons printed under a failed case start where its name does, past the verdict column. */
const CONSOLE_DETAIL_INDENT = ' '.repeat(6);
/** A reason on the console is one line; the report has the whole text. */
const CONSOLE_DETAIL_LIMIT_CHARS = 200;
const MILLISECONDS_PER_MINUTE = 60_000;
/** How much of the agent's final message the Markdown shows; `report.json` has all of it. */
export const ANSWER_REPORT_LIMIT_CHARS = 4000;
/** How many tool calls the Markdown lists per run before it counts the rest. */
export const TOOL_CALLS_REPORT_LIMIT = 80;
/** How many written paths the one-line tool summary names per tool. */
const TARGETS_PER_TOOL_IN_SUMMARY = 3;
/** The tools whose target is a file the agent meant to change; the summary line names those. */
const FILE_WRITING_TOOLS: ReadonlySet<string> = new Set([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
]);

/**
 * A case passes when enough of its graded runs did. With one run per case that is simply the run;
 * with several, `minPassRate` decides how many coin flips are tolerated. A case none of whose runs
 * could be graded fails: it measured nothing, and a green result it did not earn is the one thing
 * this report must never show.
 */
export function summarizeCase(
  set: GoldenSet,
  testCase: GoldenCase,
  runs: readonly RunResult[],
  minPassRate: number,
): CaseResult {
  const gradedRuns = runs.filter((run) => !run.errored);
  const passedRuns = gradedRuns.filter((run) => run.passed).length;
  const passRate = gradedRuns.length === 0 ? 0 : passedRuns / gradedRuns.length;

  return {
    skill: set.skill,
    id: testCase.id,
    prompt: testCase.prompt,
    invocation: testCase.invocation,
    agentModel: runs[0]?.agentModel ?? '',
    threshold: testCase.threshold,
    runs,
    graded: gradedRuns.length,
    passedRuns,
    passRate,
    passed: gradedRuns.length > 0 && passRate >= minPassRate,
  };
}

export function buildReport(
  cases: readonly CaseResult[],
  options: {
    readonly agentModel: string;
    readonly judgeModel: string;
    readonly runsPerCase: number;
    readonly minPassRate: number;
    readonly environment: string;
    readonly now?: Date;
    /** Defaults to the cases given, which is a complete report. */
    readonly plannedCases?: number;
    readonly interrupted?: readonly string[];
  },
): EvalReport {
  const runs = cases.flatMap((entry) => entry.runs);
  const plannedCases = options.plannedCases ?? cases.length;
  const interrupted = options.interrupted ?? [];

  return {
    generatedAt: (options.now ?? new Date()).toISOString(),
    agentModel: options.agentModel,
    judgeModel: options.judgeModel,
    runsPerCase: options.runsPerCase,
    minPassRate: options.minPassRate,
    environment: options.environment,
    cases,
    plannedCases,
    interrupted,
    complete: cases.length >= plannedCases && interrupted.length === 0,
    totals: {
      cases: cases.length,
      passedCases: cases.filter((entry) => entry.passed).length,
      runs: runs.length,
      erroredRuns: runs.filter((run) => run.errored).length,
      costUsd: runs.reduce((sum, run) => sum + run.costUsd + run.judgeCostUsd, 0),
      costEstimated: runs.some((run) => run.costEstimated),
    },
  };
}

function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The tool calls of a run in one line — each tool with how often it was called and, for the tools
 * that write files, which files — so "wrote nothing" and "wrote the wrong path" are visible at once.
 */
export function summarizeToolCalls(toolUses: readonly ToolUseSummary[]): string {
  if (toolUses.length === 0) {
    return 'none';
  }

  const byTool = new Map<string, { count: number; readonly targets: Set<string> }>();

  for (const toolUse of toolUses) {
    const entry = byTool.get(toolUse.name) ?? { count: 0, targets: new Set<string>() };

    entry.count += 1;

    if (FILE_WRITING_TOOLS.has(toolUse.name) && toolUse.target !== undefined) {
      entry.targets.add(toolUse.target);
    }

    byTool.set(toolUse.name, entry);
  }

  return [...byTool.entries()]
    .map(([name, entry]) => {
      const targets = [...entry.targets];
      const named = targets.slice(0, TARGETS_PER_TOOL_IN_SUMMARY).join(', ');
      const rest = targets.length - TARGETS_PER_TOOL_IN_SUMMARY;

      return `${name} ×${entry.count}${targets.length === 0 ? '' : ` → ${named}${rest > 0 ? ` and ${rest} more` : ''}`}`;
    })
    .join(', ');
}

function listChangedFiles(run: RunResult, code: boolean): string {
  if (run.changedFiles.length === 0) {
    return 'none';
  }

  return run.changedFiles.map((path) => (code ? inlineCode(path) : path)).join(', ');
}

function describeRun(run: RunResult): string[] {
  const filesLine = `  - files changed: ${listChangedFiles(run, true)}`;

  if (run.errored) {
    return [
      `- run ${run.runIndex + 1}: **error** — ${run.failure}${run.sandbox === undefined ? '' : ` (sandbox kept at \`${run.sandbox}\`)`}`,
      filesLine,
      `  - tool calls: ${summarizeToolCalls(run.toolUses)}`,
    ];
  }

  const lines = [
    `- run ${run.runIndex + 1}: **${run.passed ? 'pass' : 'fail'}** — ${formatUsd(run.costUsd + run.judgeCostUsd)}, ${Math.round(run.durationMs / 1000)} s, skills fired: ${run.skillsUsed.length === 0 ? 'none' : run.skillsUsed.join(', ')}`,
  ];

  for (const result of run.checks) {
    lines.push(
      `  - ${result.passed ? 'ok  ' : 'FAIL'} \`${result.check.type}\` — ${result.detail}`,
    );
  }

  if (run.judgement !== undefined) {
    lines.push(
      `  - judge score ${run.judgement.score} (${run.scorePassed ? 'meets' : 'below'} threshold): ${run.judgement.reasoning}`,
    );

    for (const verdict of run.judgement.assertions) {
      const mark = verdict.passed ? 'PASS' : verdict.severity === 'warn' ? 'warn' : 'FAIL';

      lines.push(`  - ${mark} ${verdict.text} — ${verdict.evidence}`);
    }
  }

  lines.push(filesLine);

  if (!run.passed) {
    lines.push(`  - tool calls: ${summarizeToolCalls(run.toolUses)}`);
  }

  if (run.sandbox !== undefined) {
    lines.push(`  - sandbox kept at \`${run.sandbox}\``);
  }

  return lines;
}

/**
 * What the agent did in a run that did not pass — every tool call in order, its final message and
 * what the harness reported about itself — folded away under the verdict. This is where a claim
 * the checks did not see is diagnosed: a file written outside the sandbox, a `git stash`, a path
 * no glob matches, a run that never got to write anything.
 */
function describeRunActivity(run: RunResult): string[] {
  const lines = [
    `<details><summary>Run ${run.runIndex + 1}: what the agent did</summary>`,
    '',
    `**Tool calls** (${run.toolUses.length}):`,
    '',
  ];

  if (run.toolUses.length === 0) {
    lines.push('(none)');
  }

  for (const toolUse of run.toolUses.slice(0, TOOL_CALLS_REPORT_LIMIT)) {
    lines.push(
      `- ${inlineCode(toolUse.name)}${toolUse.target === undefined ? '' : ` ${inlineCode(toolUse.target)}`}`,
    );
  }

  if (run.toolUses.length > TOOL_CALLS_REPORT_LIMIT) {
    lines.push(`- … ${run.toolUses.length - TOOL_CALLS_REPORT_LIMIT} more`);
  }

  lines.push('', "**Agent's final message:**", '');

  if (run.answer.trim().length === 0) {
    lines.push('(none)');
  } else {
    lines.push(fence(truncate(run.answer, ANSWER_REPORT_LIMIT_CHARS)));

    if (run.answer.length > ANSWER_REPORT_LIMIT_CHARS) {
      lines.push('', '(truncated; `report.json` has the whole message)');
    }
  }

  if (run.harness !== undefined) {
    const facts = [
      `exit code ${run.harness.exitCode ?? 'none'}`,
      ...(run.harness.resultSubtype === undefined ? [] : [`result "${run.harness.resultSubtype}"`]),
      ...(run.harness.numTurns === undefined ? [] : [`${run.harness.numTurns} turn(s)`]),
    ];

    lines.push('', `**Harness:** ${facts.join(', ')}.`);

    if (run.harness.stderr !== undefined) {
      lines.push('', '**Harness stderr (tail):**', '', fence(run.harness.stderr));
    }
  }

  lines.push('', '</details>');

  return lines;
}

/** How far a run that has not finished got, and what it was waiting on when it was stopped. */
function describeProgress(report: EvalReport): string {
  const finished = `${report.totals.cases} of ${report.plannedCases} planned case(s) finished, ${report.totals.passedCases} passed`;

  return report.interrupted.length === 0
    ? finished
    : `${finished}; stopped while running ${report.interrupted.join(', ')}`;
}

export function renderMarkdown(report: EvalReport): string {
  const lines = ['# Skill evals', ''];

  if (!report.complete) {
    lines.push(`**Partial report: ${describeProgress(report)}.**`, '');
  }

  lines.push(
    `${report.totals.passedCases}/${report.totals.cases} ${report.complete ? 'cases' : 'finished cases'} passed. Agent \`${report.agentModel}\` unless a case declares its own, judge \`${report.judgeModel}\`, ${report.runsPerCase} run(s) per case, a case passes at ${percent(report.minPassRate)} of graded runs. Spent ${formatUsd(report.totals.costUsd)}${report.totals.costEstimated ? ' (at least; partly estimated)' : ''} via ${report.environment}.`,
    '',
  );

  if (report.totals.erroredRuns > 0) {
    lines.push(
      `${report.totals.erroredRuns} run(s) did not finish and are excluded from the pass rates below; a case with no graded run fails.`,
      '',
    );
  }

  lines.push(
    '| Case | Agent | Invocation | Result | Runs passed | Score threshold |',
    '| --- | --- | --- | --- | --- | --- |',
  );

  for (const entry of report.cases) {
    lines.push(
      `| ${entry.skill}/${entry.id} | ${entry.agentModel} | ${entry.invocation} | ${entry.passed ? 'pass' : 'FAIL'} | ${entry.passedRuns}/${entry.graded}${entry.runs.length - entry.graded > 0 ? ` (+${entry.runs.length - entry.graded} errored)` : ''} | ${entry.threshold} |`,
    );
  }

  lines.push('', '## Runs', '');

  for (const entry of report.cases) {
    lines.push(`### ${entry.skill}/${entry.id}`, '', `> ${entry.prompt}`, '');

    for (const run of entry.runs) {
      lines.push(...describeRun(run));
    }

    for (const run of entry.runs) {
      if (!run.passed) {
        lines.push('', ...describeRunActivity(run));
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

/** The console line printed as soon as a case finishes, so a long sweep is readable as it runs. */
export function renderConsoleLine(entry: CaseResult): string {
  const errored = entry.runs.length - entry.graded;

  return `${entry.passed ? 'ok  ' : 'FAIL'}  ${`${entry.skill}/${entry.id}`.padEnd(CONSOLE_NAME_WIDTH)} ${entry.passedRuns}/${entry.graded} run(s) passed on ${entry.agentModel}${errored > 0 ? `, ${errored} errored` : ''}`;
}

/**
 * Under a failed case's console line, one line per reason each run did not pass — the failed
 * checks, the score, the failed assertions, then what the agent changed and called — so a failing
 * sweep can be read from the console without opening the report. Nothing for a case that passed.
 */
export function renderFailureLines(entry: CaseResult): string[] {
  if (entry.passed) {
    return [];
  }

  const lines: string[] = [];

  for (const run of entry.runs) {
    if (run.passed) {
      continue;
    }

    const reason = (text: string) =>
      lines.push(
        `${CONSOLE_DETAIL_INDENT}run ${run.runIndex + 1}: ${truncate(oneLine(text), CONSOLE_DETAIL_LIMIT_CHARS)}`,
      );

    if (run.errored) {
      reason(
        `error — ${run.failure}${run.sandbox === undefined ? '' : `; sandbox kept at ${run.sandbox}`}`,
      );
    }

    for (const result of run.checks) {
      if (!result.passed) {
        reason(`FAIL ${result.check.type} — ${result.detail}`);
      }
    }

    if (run.judgement !== undefined) {
      if (!run.scorePassed) {
        reason(
          `judge score ${run.judgement.score} below threshold ${entry.threshold} — ${run.judgement.reasoning}`,
        );
      }

      for (const verdict of run.judgement.assertions) {
        if (!verdict.passed && verdict.severity === 'error') {
          reason(`FAIL ${verdict.text} — ${verdict.evidence}`);
        }
      }
    }

    reason(
      `files changed: ${listChangedFiles(run, false)}; tool calls: ${summarizeToolCalls(run.toolUses)}`,
    );
  }

  return lines;
}

/** Printed when a run starts: a case takes minutes, and silence reads as a hang. */
export function renderStartLine(
  name: string,
  runIndex: number,
  runs: number,
  agentModel: string,
): string {
  return `run   ${name.padEnd(CONSOLE_NAME_WIDTH)} run ${runIndex + 1}/${runs} started on ${agentModel}`;
}

/** Printed once a minute while runs are in flight, naming them and how long each has taken. */
export function renderHeartbeat(inFlight: readonly InFlightRun[], now: number): string {
  const entries = inFlight.map(
    (run) =>
      `${run.name} (${Math.floor((now - run.startedAt) / MILLISECONDS_PER_MINUTE)} min on ${run.agentModel})`,
  );

  return `...   still running: ${entries.join(', ')}`;
}

/** The console's last line: the verdict, or how far a run that did not finish got. */
export function renderSummaryLine(report: EvalReport): string {
  const spent = `Spent ${formatUsd(report.totals.costUsd)}${report.totals.costEstimated ? ' (at least; partly estimated)' : ''}.`;

  return report.complete
    ? `${report.totals.passedCases}/${report.totals.cases} cases passed. ${spent}`
    : `Partial: ${describeProgress(report)}. ${spent}`;
}

/** Writes `report.json` and `report.md` into the directory, creating it, and returns their paths. */
export function writeReport(
  directory: string,
  report: EvalReport,
): { json: string; markdown: string } {
  mkdirSync(directory, { recursive: true });

  const json = join(directory, 'report.json');
  const markdown = join(directory, 'report.md');

  writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdown, renderMarkdown(report));

  return { json, markdown };
}

/**
 * Writes the report where GitHub reads a step's summary from, replacing what an earlier write of
 * the same run put there. The file is read once the step ends, so the last write is the one shown,
 * and rewriting it after every finished case leaves a partial report on the run's page even when
 * the job is cancelled or times out before the command can finish.
 */
export function writeStepSummary(path: string, report: EvalReport): void {
  writeFileSync(path, `${renderMarkdown(report)}\n`);
}
