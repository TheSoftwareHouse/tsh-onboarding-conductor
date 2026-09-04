import { normalizeWorkflowField } from '../fields/field.normalizer';
import { WorkflowInvalidError } from '../workflow-invalid.error';
import { normalizeCondition, type ConditionNormalizationContext } from './condition.normalizer';

describe('normalizeCondition — score leaf', () => {
  const countryField = normalizeWorkflowField({ type: 'text', required: true }, 'root');

  const baseContext: ConditionNormalizationContext = {
    rootFieldNames: new Set(['country']),
    fieldDefinitionsByName: { country: countryField },
  };

  const transitionContext: ConditionNormalizationContext = {
    ...baseContext,
    declaredScores: new Set(['risk']),
  };

  const expectReason = (fn: () => unknown, reason: string): void => {
    try {
      fn();
      throw new Error('Expected normalizeCondition to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowInvalidError);
      expect(error).toMatchObject({ reason });
    }
  };

  it('refuses a score leaf when declaredScores is absent from the context (field when)', () => {
    expectReason(
      () => normalizeCondition({ score: 'risk', gte: 70 }, baseContext),
      'UNKNOWN_PROPERTY',
    );
  });

  it('refuses a score leaf naming an undeclared score', () => {
    expectReason(
      () => normalizeCondition({ score: 'unknown', gte: 70 }, transitionContext),
      'INVALID_VALUE',
    );
  });

  it('refuses a score leaf with a blank score name', () => {
    expectReason(
      () => normalizeCondition({ score: '   ', gte: 70 }, transitionContext),
      'INVALID_VALUE',
    );
  });

  it('refuses a score leaf carrying more than one comparator', () => {
    expectReason(
      () => normalizeCondition({ score: 'risk', gte: 70, lte: 90 }, transitionContext),
      'INVALID_SHAPE',
    );
  });

  it('refuses a score leaf with no comparator at all', () => {
    expectReason(() => normalizeCondition({ score: 'risk' }, transitionContext), 'INVALID_SHAPE');
  });

  it('refuses a score leaf whose threshold is not an integer', () => {
    expectReason(
      () => normalizeCondition({ score: 'risk', gte: 70.5 }, transitionContext),
      'INVALID_VALUE',
    );
  });

  it.each(['gte', 'gt', 'lte', 'lt'] as const)(
    'normalizes a %s score leaf when declaredScores names it',
    (comparator) => {
      expect(normalizeCondition({ score: 'risk', [comparator]: 70 }, transitionContext)).toEqual({
        score: 'risk',
        [comparator]: 70,
      });
    },
  );

  it('normalizes a score leaf nested inside all, any and not', () => {
    expect(
      normalizeCondition(
        {
          all: [
            { score: 'risk', gte: 70 },
            { field: 'country', equals: 'PL' },
          ],
        },
        transitionContext,
      ),
    ).toEqual({
      all: [
        { score: 'risk', gte: 70 },
        { field: 'country', equals: 'PL' },
      ],
    });

    expect(normalizeCondition({ any: [{ score: 'risk', lt: 10 }] }, transitionContext)).toEqual({
      any: [{ score: 'risk', lt: 10 }],
    });

    expect(normalizeCondition({ not: { score: 'risk', gte: 70 } }, transitionContext)).toEqual({
      not: { score: 'risk', gte: 70 },
    });
  });

  it('still normalizes an ordinary field condition when declaredScores is present', () => {
    expect(normalizeCondition({ field: 'country', equals: 'PL' }, transitionContext)).toEqual({
      field: 'country',
      equals: 'PL',
    });
  });
});
