import { normalizeCondition, type ConditionNormalizationContext } from './condition.normalizer';
import type { AnyNormalizedField } from '../fields/field-type.port';
import { SCORE_CONDITION_VARIABLE } from '../scoring/condition-variable';
import { WorkflowInvalidError } from '../workflow-invalid.error';

const numberField = { type: 'number', required: true, persist: true } as AnyNormalizedField;
const textField = { type: 'text', required: true, persist: true } as AnyNormalizedField;

/** The context a transition's `when` is normalized with: no `currentFieldName`. */
const transitionContext: ConditionNormalizationContext = {
  rootFieldNames: new Set(['age', 'country']),
  fieldDefinitionsByName: { age: numberField, country: textField },
};

/** The context a field's own `when` is normalized with, which pins `currentFieldName`. */
const fieldContext: ConditionNormalizationContext = {
  ...transitionContext,
  currentFieldName: 'country',
};

const expectRejected = (condition: unknown, context = transitionContext): void => {
  expect(() => normalizeCondition(condition, context)).toThrow(WorkflowInvalidError);
};

describe('normalizeCondition', () => {
  describe('the $score condition variable', () => {
    it('accepts $score with gte and with lt', () => {
      expect(
        normalizeCondition({ field: SCORE_CONDITION_VARIABLE, gte: 80 }, transitionContext),
      ).toEqual({ field: SCORE_CONDITION_VARIABLE, gte: 80 });

      expect(
        normalizeCondition({ field: SCORE_CONDITION_VARIABLE, lt: 40 }, transitionContext),
      ).toEqual({ field: SCORE_CONDITION_VARIABLE, lt: 40 });
    });

    it('accepts a $score band composed under all', () => {
      expect(
        normalizeCondition(
          {
            all: [
              { field: SCORE_CONDITION_VARIABLE, gte: 40 },
              { field: SCORE_CONDITION_VARIABLE, lt: 80 },
            ],
          },
          transitionContext,
        ),
      ).toEqual({
        all: [
          { field: SCORE_CONDITION_VARIABLE, gte: 40 },
          { field: SCORE_CONDITION_VARIABLE, lt: 80 },
        ],
      });
    });

    it('refuses equality-shaped operators against a running total', () => {
      expectRejected({ field: SCORE_CONDITION_VARIABLE, equals: 80 });
      expectRejected({ field: SCORE_CONDITION_VARIABLE, in: [80, 90] });
      expectRejected({ field: SCORE_CONDITION_VARIABLE, isSet: true });
    });

    it('refuses a condition variable inside a field-level when', () => {
      expectRejected({ field: SCORE_CONDITION_VARIABLE, gte: 80 }, fieldContext);
    });

    it('refuses an unknown condition variable', () => {
      expectRejected({ field: '$elapsedMinutes', gte: 5 });
      expectRejected({ field: '$', gte: 5 });
    });

    it('refuses a non-numeric threshold', () => {
      expectRejected({ field: SCORE_CONDITION_VARIABLE, gte: '80' });
      expectRejected({ field: SCORE_CONDITION_VARIABLE, gte: null });
      expectRejected({ field: SCORE_CONDITION_VARIABLE, lt: Number.POSITIVE_INFINITY });
    });
  });

  describe('gte and lt against a declared field', () => {
    it('accepts them against a number field', () => {
      expect(normalizeCondition({ field: 'age', gte: 18 }, transitionContext)).toEqual({
        field: 'age',
        gte: 18,
      });
      expect(normalizeCondition({ field: 'age', lt: 65 }, transitionContext)).toEqual({
        field: 'age',
        lt: 65,
      });
    });

    it('refuses them against a field that does not hold a number', () => {
      expectRejected({ field: 'country', gte: 1 });
      expectRejected({ field: 'country', lt: 1 });
    });

    it('refuses a non-numeric threshold', () => {
      expectRejected({ field: 'age', gte: '18' });
    });

    it('refuses an undeclared field', () => {
      expectRejected({ field: 'unknownField', gte: 1 });
    });
  });

  describe('shape rules the new operators inherit', () => {
    it('still rejects an unknown property', () => {
      expectRejected({ field: 'age', gte: 18, nonsense: true });
    });

    it('still rejects more than one operator on a node', () => {
      expectRejected({ field: 'age', gte: 18, lt: 65 });
    });

    it('leaves the existing operators working', () => {
      expect(normalizeCondition({ field: 'country', equals: 'US' }, transitionContext)).toEqual({
        field: 'country',
        equals: 'US',
      });
      expect(normalizeCondition({ field: 'country', isSet: true }, transitionContext)).toEqual({
        field: 'country',
        isSet: true,
      });
    });
  });
});
