import { AGENT_MODEL_ENV, DEFAULTS, JUDGE_MODEL_ENV, parseArgs } from './cli';

describe('parseArgs', () => {
  it('fills the defaults, letting the environment name the models', () => {
    const parsed = parseArgs([], {});
    const fromEnv = parseArgs([], { [AGENT_MODEL_ENV]: 'sonnet', [JUDGE_MODEL_ENV]: 'opus' });

    expect(parsed).toEqual({
      options: expect.objectContaining({
        skills: [],
        runs: DEFAULTS.runs,
        agentModel: DEFAULTS.agentModel,
        judgeModel: DEFAULTS.judgeModel,
        minPassRate: DEFAULTS.minPassRate,
        concurrency: DEFAULTS.concurrency,
        printReport: false,
        dryRun: false,
        validate: false,
      }),
    });
    expect(fromEnv).toEqual({
      options: expect.objectContaining({ agentModel: 'sonnet', judgeModel: 'opus' }),
    });
  });

  it('reads every flag, with the command line beating the environment', () => {
    const parsed = parseArgs(
      [
        '--skill',
        'a',
        '--skill',
        'b',
        '--case',
        'port',
        '--runs',
        '3',
        '--model',
        'sonnet',
        '--override-model',
        'opus',
        '--judge-model',
        'haiku',
        '--threshold',
        '80',
        '--pass-rate',
        '0.67',
        '--max-budget-usd',
        '3',
        '--judge-max-budget-usd',
        '0.5',
        '--timeout-minutes',
        '20',
        '--concurrency',
        '1',
        '--report-dir',
        'out',
        '--print-report',
        '--keep-sandbox',
        '--dry-run',
        '--validate',
      ],
      { [AGENT_MODEL_ENV]: 'opus' },
    );

    expect(parsed).toEqual({
      options: {
        skills: ['a', 'b'],
        caseFilter: 'port',
        runs: 3,
        agentModel: 'sonnet',
        overrideModel: 'opus',
        judgeModel: 'haiku',
        threshold: 80,
        minPassRate: 0.67,
        maxBudgetUsd: 3,
        judgeMaxBudgetUsd: 0.5,
        timeoutMinutes: 20,
        concurrency: 1,
        reportDir: 'out',
        printReport: true,
        keepSandbox: true,
        dryRun: true,
        validate: true,
        help: false,
      },
    });
  });

  it('rejects malformed values and unknown flags with the flag named', () => {
    expect(parseArgs(['--runs', '0'], {})).toEqual({ error: expect.stringContaining('--runs') });
    expect(parseArgs(['--threshold', '101'], {})).toEqual({
      error: expect.stringContaining('--threshold'),
    });
    expect(parseArgs(['--pass-rate', '0'], {})).toEqual({
      error: expect.stringContaining('--pass-rate'),
    });
    expect(parseArgs(['--model', '--runs'], {})).toEqual({
      error: expect.stringContaining('--model'),
    });
    expect(parseArgs(['--skill'], {})).toEqual({ error: expect.stringContaining('--skill') });
    expect(parseArgs(['--bogus'], {})).toEqual({ error: 'unknown option --bogus' });
  });
});
