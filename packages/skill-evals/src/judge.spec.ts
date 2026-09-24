import { JUDGE_SCHEMA, buildJudgePrompt, judgeRun, parseJudgement } from './judge';
import * as runner from './runner';

const assertions = [
  { text: 'It names the code', severity: 'error' as const },
  { text: 'It mentions expiry', severity: 'warn' as const },
];

describe('buildJudgePrompt', () => {
  it('lays out the prompt, expectation, golden, answer, artifacts and numbered assertions', () => {
    const prompt = buildJudgePrompt({
      prompt: 'Do the thing',
      expectedOutput: 'The thing, done',
      goldenName: 'golden/answer.md',
      goldenContent: 'golden text with ``` inside',
      answer: 'I did the thing',
      artifacts: [
        { path: 'a.json', status: 'added', content: '{}', truncated: false },
        { path: 'b.bin', status: 'modified', truncated: true },
        { path: 'c.txt', status: 'deleted', truncated: false },
      ],
      assertions,
    });

    expect(prompt).toContain('## Prompt given to the agent\nDo the thing');
    expect(prompt).toContain(
      '## Golden reference (golden/answer.md)\n````\ngolden text with ``` inside\n````',
    );
    expect(prompt).toContain("## Agent's final message\nI did the thing");
    expect(prompt).toContain('### a.json (added)\n```\n{}\n```');
    expect(prompt).toContain('### b.bin (modified)\n(binary or too large to show)');
    expect(prompt).toContain('### c.txt (deleted)\n(deleted)');
    expect(prompt).toContain('1. It names the code\n2. It mentions expiry');
  });

  it('says so when nothing changed, nothing was answered and nothing is asserted', () => {
    const prompt = buildJudgePrompt({
      prompt: 'p',
      expectedOutput: 'e',
      answer: '  ',
      artifacts: [],
      assertions: [],
    });

    expect(prompt).toContain('(empty)');
    expect(prompt).toContain('(none)');
    expect(prompt).toContain('return an empty assertions list');
  });
});

describe('parseJudgement', () => {
  it('accepts a graded answer and keeps each assertion with its severity', () => {
    const { judgement, problem } = parseJudgement(
      {
        score: 82.4,
        reasoning: 'Mostly there',
        assertions: [
          { index: 2, passed: false, evidence: 'no expiry' },
          { index: 1, passed: true, evidence: 'names DOCUMENT_UPLOAD_CONFLICT' },
        ],
      },
      assertions,
    );

    expect(problem).toBeUndefined();
    expect(judgement).toEqual({
      score: 82,
      reasoning: 'Mostly there',
      assertions: [
        { ...assertions[0], passed: true, evidence: 'names DOCUMENT_UPLOAD_CONFLICT' },
        { ...assertions[1], passed: false, evidence: 'no expiry' },
      ],
    });
  });

  it('refuses what the schema cannot: a score out of range, an ungraded assertion, no output', () => {
    expect(parseJudgement({ score: 101, reasoning: 'x', assertions: [] }, []).problem).toContain(
      'between 0 and 100',
    );
    expect(
      parseJudgement({ score: 50, reasoning: 'x', assertions: [] }, assertions).problem,
    ).toContain('assertion 1');
    expect(parseJudgement(undefined, []).problem).toContain('no structured output');
  });
});

describe('judgeRun', () => {
  const baseRun = {
    availableSkills: [],
    code: 0,
    costEstimated: false,
    costUnpriced: [],
    costUsd: 0.004,
    skillsUsed: [],
    stderr: '',
    stoppedEarly: false,
    timedOut: false,
    timeoutMs: 180_000,
    toolUses: [],
    tokens: 1500,
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runs one tool-less call with the rubric as system prompt and the schema, in an empty directory', async () => {
    const spy = jest.spyOn(runner, 'runClaude').mockResolvedValue({
      ...baseRun,
      result: { subtype: 'success', total_cost_usd: 0.004 },
      structuredOutput: {
        score: 90,
        reasoning: 'good',
        assertions: [{ index: 1, passed: true, evidence: 'yes' }],
      },
    });

    const outcome = await judgeRun(
      { prompt: 'p', expectedOutput: 'e', answer: 'a', artifacts: [], assertions: [assertions[0]] },
      { model: 'haiku', maxBudgetUsd: 0.25, timeoutMs: 1000 },
    );

    expect(outcome).toMatchObject({
      judgement: { score: 90 },
      costUsd: 0.004,
      costEstimated: false,
    });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'haiku',
        tools: [],
        jsonSchema: JUDGE_SCHEMA,
        strictMcpConfig: true,
        disableSkills: true,
        systemPrompt: expect.stringContaining('Rules:'),
      }),
    );
    expect(spy.mock.calls[0][0].cwd).not.toBe(process.cwd());
  });

  it('reports a run the harness ended as a failure rather than a verdict', async () => {
    jest.spyOn(runner, 'runClaude').mockResolvedValue({
      ...baseRun,
      result: { subtype: 'error_max_budget_usd' },
    });

    const outcome = await judgeRun(
      { prompt: 'p', expectedOutput: 'e', answer: 'a', artifacts: [], assertions: [] },
      { model: 'haiku', maxBudgetUsd: 0.25, timeoutMs: 1000 },
    );

    expect(outcome.judgement).toBeUndefined();
    expect(outcome.failure).toContain('error_max_budget_usd');
  });
});
