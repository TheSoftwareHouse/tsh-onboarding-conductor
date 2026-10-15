import { parseCreditConfig } from './credit-config';
import { CREDIT_REPORT_MAX_BYTES } from './credit-contract';
import {
  buildCreditSubmittedData,
  evaluateCreditOutcome,
  trimCreditReport,
} from './credit-outcome';
import type { CreditResult } from './credit-provider.port';

const config = parseCreditConfig('test_credit', {
  bands: { approveFrom: 700, reviewFrom: 400 },
  maxAttempts: 3,
});

const scored = (
  value: number,
  report: Record<string, unknown> = {},
): CreditResult & {
  status: 'scored';
} => ({
  status: 'scored',
  score: {
    value,
    scale: { min: 0, max: 1000 },
    indicators: { income: 2 },
    secondary: { paymentScore: { value: 7, scale: { min: 1, max: 10 } } },
  },
  report,
});

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

describe('evaluateCreditOutcome', () => {
  it.each([
    [950, 'approved', 'approve'],
    [700, 'approved', 'approve'],
    [699.6, 'approved', 'approve'],
    [699.4, 'review', 'review'],
    [699, 'review', 'review'],
    [550, 'review', 'review'],
    [400, 'review', 'review'],
    [399, 'declined', 'decline'],
    [0, 'declined', 'decline'],
  ])('bands a score of %i as %s', (value, outcome, band) => {
    expect(evaluateCreditOutcome(scored(value), config, 1)).toEqual({
      outcome,
      band,
      reasonCodes: [],
    });
  });

  it('retries a failure while attempts remain, carrying the provider codes', () => {
    expect(
      evaluateCreditOutcome({ status: 'failed', codes: ['NO_CHECKING_ACCOUNT'] }, config, 2),
    ).toEqual({ outcome: 'retry', reasonCodes: ['NO_CHECKING_ACCOUNT'] });
  });

  it('sends a failure to review once the attempt limit is reached', () => {
    expect(
      evaluateCreditOutcome({ status: 'failed', codes: ['NO_CHECKING_ACCOUNT'] }, config, 3),
    ).toEqual({ outcome: 'review', reasonCodes: ['NO_CHECKING_ACCOUNT'] });
  });
});

describe('trimCreditReport', () => {
  const filler = 'x'.repeat(CREDIT_REPORT_MAX_BYTES);

  it('leaves a report under the cap untouched', () => {
    const report = { scores: [1], transactions: [1] };

    expect(trimCreditReport(report)).toBe(report);
  });

  it('drops top-level transactions first', () => {
    const report = { scores: [1], transactions: [filler], creditInsights: { cashFlows: [1] } };

    expect(trimCreditReport(report)).toEqual({
      scores: [1],
      creditInsights: { cashFlows: [1] },
    });
  });

  it('then drops every nested transactions array inside creditInsights', () => {
    const report = {
      scores: [1],
      transactions: [filler],
      creditInsights: { cashFlows: [1], income: { transactions: [filler], total: 5 } },
    };

    expect(trimCreditReport(report)).toEqual({
      scores: [1],
      creditInsights: { cashFlows: [1], income: { total: 5 } },
    });
  });

  it('then drops creditInsights.cashFlows', () => {
    const report = {
      scores: [1],
      creditInsights: { cashFlows: [filler], income: { total: 5 } },
    };

    expect(trimCreditReport(report)).toEqual({
      scores: [1],
      creditInsights: { income: { total: 5 } },
    });
  });

  it('replaces a report still over the cap with a marker carrying its size', () => {
    const report = { scores: [filler] };

    expect(trimCreditReport(report)).toEqual({ truncated: true, bytes: bytes(report) });
  });

  it('keeps a report at exactly the cap', () => {
    const overhead = bytes({ pad: '' });
    const report = { pad: 'x'.repeat(CREDIT_REPORT_MAX_BYTES - overhead) };

    expect(bytes(report)).toBe(CREDIT_REPORT_MAX_BYTES);
    expect(trimCreditReport(report)).toBe(report);
  });
});

describe('buildCreditSubmittedData', () => {
  it('emits every credit field for a scored result', () => {
    const result = scored(712.4, { scores: [1] });
    const evaluation = evaluateCreditOutcome(result, config, 1);

    expect(
      buildCreditSubmittedData({
        result,
        evaluation,
        config,
        attemptCount: 1,
        providerReference: 'c1/a1',
      }),
    ).toEqual({
      creditOutcome: 'approved',
      creditScore: 712,
      creditScoreBand: 'approve',
      creditIndicators: { income: 2 },
      creditSecondaryScores: { paymentScore: { value: 7, scale: { min: 1, max: 10 } } },
      creditReasonCodes: [],
      creditAttemptCount: 1,
      creditProviderReference: 'c1/a1',
      creditReport: { scores: [1] },
    });
  });

  it('rounds the score once, so the emitted score and its band agree', () => {
    const submit = (value: number) => {
      const result = scored(value);
      return buildCreditSubmittedData({
        result,
        evaluation: evaluateCreditOutcome(result, config, 1),
        config,
        attemptCount: 1,
        providerReference: 'c1/a1',
      });
    };

    expect(submit(699.6)).toMatchObject({ creditScore: 700, creditScoreBand: 'approve' });
    expect(submit(699.4)).toMatchObject({ creditScore: 699, creditScoreBand: 'review' });
  });

  it('emits only the outcome, codes, attempt and reference for a failure', () => {
    const result: CreditResult & { status: 'failed' } = { status: 'failed', codes: ['E1'] };
    const evaluation = evaluateCreditOutcome(result, config, 1);

    expect(
      buildCreditSubmittedData({
        result,
        evaluation,
        config,
        attemptCount: 1,
        providerReference: 'c1/a1',
      }),
    ).toEqual({
      creditOutcome: 'retry',
      creditReasonCodes: ['E1'],
      creditAttemptCount: 1,
      creditProviderReference: 'c1/a1',
    });
  });

  it('trims an oversized report to the cap', () => {
    const result = scored(800, {
      scores: [1],
      transactions: ['x'.repeat(CREDIT_REPORT_MAX_BYTES)],
    });
    const submitted = buildCreditSubmittedData({
      result,
      evaluation: evaluateCreditOutcome(result, config, 1),
      config,
      attemptCount: 1,
      providerReference: 'c1/a1',
    });

    expect(submitted.creditReport).toEqual({ scores: [1] });
  });

  it('honours the report mode: none omits it, summary keeps scores and metadata', () => {
    const result = scored(800, { scores: [1], metadata: { a: 1 }, accounts: [2] });
    const evaluation = evaluateCreditOutcome(result, config, 1);
    const build = (report: 'none' | 'summary') =>
      buildCreditSubmittedData({
        result,
        evaluation,
        config: { ...config, report },
        attemptCount: 1,
        providerReference: 'c1/a1',
      });

    expect(build('none')).not.toHaveProperty('creditReport');
    expect(build('summary').creditReport).toEqual({ scores: [1], metadata: { a: 1 } });
  });
});
