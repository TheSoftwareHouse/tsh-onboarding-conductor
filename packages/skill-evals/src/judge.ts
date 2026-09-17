import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Assertion, type AssertionSeverity, SCORE_MAX, SCORE_MIN } from './golden-set';
import { fence } from './markdown';
import { describeRunFailure, runClaude } from './runner';

/** A file the agent changed, as the judge sees it. Content is omitted for binaries and large files. */
export type Artifact = {
  readonly path: string;
  readonly status: 'added' | 'modified' | 'deleted';
  readonly content?: string;
  readonly truncated: boolean;
};

export type JudgeInput = {
  readonly prompt: string;
  readonly expectedOutput: string;
  readonly goldenName?: string;
  readonly goldenContent?: string;
  readonly answer: string;
  readonly artifacts: readonly Artifact[];
  readonly assertions: readonly Assertion[];
};

export type AssertionVerdict = {
  readonly text: string;
  readonly severity: AssertionSeverity;
  readonly passed: boolean;
  readonly evidence: string;
};

export type Judgement = {
  readonly score: number;
  readonly reasoning: string;
  readonly assertions: readonly AssertionVerdict[];
};

export type JudgeOptions = {
  readonly model: string;
  readonly maxBudgetUsd: number;
  readonly timeoutMs: number;
};

export type JudgeOutcome = {
  readonly judgement?: Judgement;
  readonly failure?: string;
  readonly costUsd: number;
  readonly costEstimated: boolean;
};

/** What the harness validates the judge's answer against, and hands back parsed. */
export const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'reasoning', 'assertions'],
  properties: {
    score: { type: 'number', description: `${SCORE_MIN}-${SCORE_MAX}` },
    reasoning: { type: 'string' },
    assertions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'passed', 'evidence'],
        properties: {
          index: { type: 'number', description: '1-based, as numbered in the prompt' },
          passed: { type: 'boolean' },
          evidence: { type: 'string' },
        },
      },
    },
  },
} as const;

/**
 * The rubric: the expectation is required core content, extra correct detail is never a fault, and
 * every assertion needs evidence. Kept as the system prompt so the harness's own agent framing
 * never reaches the judge.
 */
export const JUDGE_SYSTEM_PROMPT = [
  'You grade the work of a coding agent against a golden expectation written by a human. The agent',
  'was given a prompt inside a copy of a software repository and finished with a final message,',
  'sometimes after changing files. You see the prompt, the expected output, the final message, the',
  'files the agent changed and, when one exists, a golden reference a human considers correct.',
  '',
  'Rules:',
  '- The EXPECTED OUTPUT states required core content, not wording. Score how completely the',
  '  actual result conveys that content. Phrasing, ordering, extra correct detail and different',
  '  but equivalent identifiers (step names, field names, variable names) are not faults.',
  '- A bracketed placeholder such as [id] or [value] in the expectation matches any concrete',
  '  value of that kind.',
  '- Lower the score only for a contradiction, an omission of required content, an answer to a',
  '  different question, or an artifact that does something the expectation does not describe.',
  '- The golden reference shows one correct result, not the only one. An actual result that reaches',
  '  the same outcome by a different route is correct.',
  '- Grade every numbered assertion separately. PASS needs concrete evidence quoted or precisely',
  '  referenced from the actual output; FAIL when the evidence is absent or contradicts it. Never',
  '  give the benefit of the doubt, and never infer that something was done because it should have',
  '  been.',
  `- Scale for the score: ${SCORE_MAX} excellent; 90-99 very strong; 80-89 good with small gaps;`,
  '  60-79 adequate with notable gaps; 40-59 weak; 0-39 poor or absent.',
  '',
  'Reply with JSON matching the schema and nothing else.',
].join('\n');

export function buildJudgePrompt(input: JudgeInput): string {
  const sections: string[] = [
    '## Prompt given to the agent',
    input.prompt,
    '',
    '## Expected output',
    input.expectedOutput,
  ];

  if (input.goldenContent !== undefined) {
    sections.push(
      '',
      `## Golden reference (${input.goldenName ?? 'golden'})`,
      fence(input.goldenContent),
    );
  }

  sections.push(
    '',
    "## Agent's final message",
    input.answer.trim().length === 0 ? '(empty)' : input.answer,
  );

  sections.push('', '## Files the agent changed');

  if (input.artifacts.length === 0) {
    sections.push('(none)');
  }

  for (const artifact of input.artifacts) {
    sections.push('', `### ${artifact.path} (${artifact.status})`);

    if (artifact.content === undefined) {
      sections.push(artifact.status === 'deleted' ? '(deleted)' : '(binary or too large to show)');
    } else {
      sections.push(fence(artifact.content));

      if (artifact.truncated) {
        sections.push('(truncated)');
      }
    }
  }

  sections.push('', '## Assertions to grade');

  if (input.assertions.length === 0) {
    sections.push('(none — return an empty assertions list)');
  }

  input.assertions.forEach((assertion, index) => {
    sections.push(`${index + 1}. ${assertion.text}`);
  });

  return sections.join('\n');
}

/**
 * Turns the harness's validated JSON into a judgement, or says why it cannot. The schema fixes the
 * shape, so what is checked here is what a schema cannot say: the score is in range and every
 * assertion was graded exactly once.
 */
export function parseJudgement(
  output: unknown,
  assertions: readonly Assertion[],
): { readonly judgement?: Judgement; readonly problem?: string } {
  if (typeof output !== 'object' || output === null) {
    return { problem: 'the judge returned no structured output' };
  }

  const record = output as Record<string, unknown>;
  const score = record.score;

  if (
    typeof score !== 'number' ||
    !Number.isFinite(score) ||
    score < SCORE_MIN ||
    score > SCORE_MAX
  ) {
    return {
      problem: `the judge's score is not a number between ${SCORE_MIN} and ${SCORE_MAX}: ${String(score)}`,
    };
  }

  if (typeof record.reasoning !== 'string') {
    return { problem: 'the judge gave no reasoning' };
  }

  const verdicts = Array.isArray(record.assertions) ? record.assertions : [];
  const byIndex = new Map<number, { passed: boolean; evidence: string }>();

  for (const verdict of verdicts) {
    if (typeof verdict !== 'object' || verdict === null) {
      continue;
    }

    const entry = verdict as Record<string, unknown>;

    if (typeof entry.index === 'number' && typeof entry.passed === 'boolean') {
      byIndex.set(entry.index, {
        passed: entry.passed,
        evidence: typeof entry.evidence === 'string' ? entry.evidence : '',
      });
    }
  }

  const graded: AssertionVerdict[] = [];

  for (const [position, assertion] of assertions.entries()) {
    const verdict = byIndex.get(position + 1);

    if (verdict === undefined) {
      return { problem: `the judge did not grade assertion ${position + 1}` };
    }

    graded.push({ ...assertion, passed: verdict.passed, evidence: verdict.evidence });
  }

  return {
    judgement: { score: Math.round(score), reasoning: record.reasoning, assertions: graded },
  };
}

/**
 * One judge call. It runs in an empty directory so no `CLAUDE.md`, skill or MCP server of this
 * repository or this machine reaches it: the judge sees the rubric and the case, nothing else.
 */
export async function judgeRun(input: JudgeInput, options: JudgeOptions): Promise<JudgeOutcome> {
  const workdir = mkdtempSync(join(tmpdir(), 'tsh-skill-evals-judge-'));

  try {
    const run = await runClaude({
      cwd: workdir,
      prompt: buildJudgePrompt(input),
      model: options.model,
      tools: [],
      permissionMode: 'dontAsk',
      maxBudgetUsd: options.maxBudgetUsd,
      timeoutMs: options.timeoutMs,
      systemPrompt: JUDGE_SYSTEM_PROMPT,
      jsonSchema: JUDGE_SCHEMA,
      strictMcpConfig: true,
      disableSkills: true,
    });
    const failure = describeRunFailure(run);

    if (failure !== undefined) {
      return {
        failure: `judge: ${failure}`,
        costUsd: run.costUsd,
        costEstimated: run.costEstimated,
      };
    }

    const parsed = parseJudgement(run.structuredOutput, input.assertions);

    if (parsed.judgement === undefined) {
      return {
        failure: `judge: ${parsed.problem}`,
        costUsd: run.costUsd,
        costEstimated: run.costEstimated,
      };
    }

    return { judgement: parsed.judgement, costUsd: run.costUsd, costEstimated: run.costEstimated };
  } finally {
    rmSync(workdir, { force: true, recursive: true });
  }
}
