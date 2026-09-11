import type { ConditionNormalizationContext } from '../conditions/condition.normalizer';
import { normalizeWorkflowField } from '../fields/field.normalizer';
import type { CompiledWorkflowStep } from '../workflow-contract';
import { WorkflowInvalidError } from '../workflow-invalid.error';
import { normalizeScoreDeclarations, normalizeScoringRules } from './scoring.normalizer';

const expectReason = (fn: () => unknown, reason: string): void => {
  try {
    fn();
    throw new Error('Expected normalization to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(WorkflowInvalidError);
    expect(error).toMatchObject({ reason });
  }
};

describe('normalizeScoreDeclarations', () => {
  it('normalizes an undeclared scoring block to {}', () => {
    expect(normalizeScoreDeclarations(undefined)).toEqual({});
  });

  it('normalizes a valid declaration keyed by name', () => {
    expect(normalizeScoreDeclarations({ risk: { min: 0, max: 100 } })).toEqual({
      risk: { name: 'risk', min: 0, max: 100 },
    });
  });

  it('normalizes several declarations', () => {
    expect(
      normalizeScoreDeclarations({
        risk: { min: 0, max: 100 },
        trust: { min: -10, max: 10 },
      }),
    ).toEqual({
      risk: { name: 'risk', min: 0, max: 100 },
      trust: { name: 'trust', min: -10, max: 10 },
    });
  });

  it('rejects a non-object scoring block', () => {
    expectReason(() => normalizeScoreDeclarations([]), 'INVALID_SHAPE');
  });

  it('rejects a non-object score declaration', () => {
    expectReason(() => normalizeScoreDeclarations({ risk: 100 }), 'INVALID_SHAPE');
  });

  it('rejects a blank score name', () => {
    expectReason(
      () => normalizeScoreDeclarations({ '   ': { min: 0, max: 100 } }),
      'INVALID_VALUE',
    );
  });

  it.each([
    ['non-integer min', { min: 0.5, max: 100 }],
    ['non-integer max', { min: 0, max: 100.5 }],
    ['min equal to max', { min: 50, max: 50 }],
    ['min greater than max', { min: 100, max: 0 }],
  ])('rejects %s', (_label, declaration) => {
    expectReason(() => normalizeScoreDeclarations({ risk: declaration }), 'INVALID_VALUE');
  });
});

describe('normalizeScoringRules', () => {
  const countryField = normalizeWorkflowField({ type: 'text', required: true }, 'root');

  const context: ConditionNormalizationContext = {
    rootFieldNames: new Set(['country']),
    fieldDefinitionsByName: { country: countryField },
  };

  const declaredScores = new Set(['risk']);

  const buildStep = (overrides: Partial<CompiledWorkflowStep> = {}): CompiledWorkflowStep => ({
    name: 'collect_profile',
    status: 'awaiting_user',
    data: {},
    transitions: [],
    ...overrides,
  });

  it('normalizes to [] when the step declares no scoring', () => {
    expect(normalizeScoringRules(buildStep(), context, declaredScores)).toEqual([]);
  });

  it('normalizes to [] when the step declares no scoring, even with no declared scores', () => {
    expect(normalizeScoringRules(buildStep(), context, new Set())).toEqual([]);
  });

  it('normalizes rules in declared order, each with its when normalized', () => {
    const step = buildStep({
      scoring: [
        { score: 'risk', when: { field: 'country', in: ['RU', 'IR'] }, add: 40 },
        { score: 'risk', when: { field: 'country', equals: 'PL' }, add: -10 },
        { score: 'risk', add: 5 },
      ],
    });

    expect(normalizeScoringRules(step, context, declaredScores)).toEqual([
      { score: 'risk', when: { field: 'country', in: ['RU', 'IR'] }, add: 40 },
      { score: 'risk', when: { field: 'country', equals: 'PL' }, add: -10 },
      { score: 'risk', add: 5 },
    ]);
  });

  it('rejects a step declaring scoring when the root declares no scoring at all', () => {
    const step = buildStep({ scoring: [{ score: 'risk', add: 5 }] });

    expectReason(() => normalizeScoringRules(step, context, new Set()), 'INVALID_VALUE');
  });

  it('rejects a rule naming a score the root does not declare', () => {
    const step = buildStep({ scoring: [{ score: 'unknown', add: 5 }] });

    expectReason(() => normalizeScoringRules(step, context, declaredScores), 'INVALID_VALUE');
  });

  it.each([
    ['a non-integer add', { score: 'risk', add: 5.5 }],
    ['a zero add', { score: 'risk', add: 0 }],
  ])('rejects %s', (_label, rule) => {
    const step = buildStep({ scoring: [rule] });

    expectReason(() => normalizeScoringRules(step, context, declaredScores), 'INVALID_VALUE');
  });

  it("refuses a score leaf inside a rule's own when", () => {
    const step = buildStep({
      scoring: [{ score: 'risk', when: { score: 'risk', gte: 10 }, add: 5 }],
    });

    expectReason(() => normalizeScoringRules(step, context, declaredScores), 'UNKNOWN_PROPERTY');
  });
});
