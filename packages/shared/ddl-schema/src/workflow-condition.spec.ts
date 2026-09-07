import { collectConditionReferences, evaluateCondition } from './workflow-condition';

describe('evaluateCondition', () => {
  const context = {
    country: 'US',
    age: 18,
    presentNull: null,
  };

  it('evaluates all/any/not compositions against the provided context', () => {
    expect(
      evaluateCondition(
        {
          all: [
            { field: 'country', equals: 'US' },
            { field: 'age', equals: 18 },
          ],
        },
        context,
      ),
    ).toBe(true);

    expect(
      evaluateCondition(
        {
          all: [
            { field: 'country', equals: 'CA' },
            { field: 'age', equals: 18 },
          ],
        },
        context,
      ),
    ).toBe(false);

    expect(
      evaluateCondition(
        {
          any: [
            { field: 'country', equals: 'CA' },
            { field: 'age', equals: 18 },
          ],
        },
        context,
      ),
    ).toBe(true);

    expect(
      evaluateCondition(
        {
          any: [
            { field: 'country', equals: 'CA' },
            { field: 'age', equals: 19 },
          ],
        },
        context,
      ),
    ).toBe(false);

    expect(evaluateCondition({ not: { field: 'country', equals: 'CA' } }, context)).toBe(true);
    expect(evaluateCondition({ not: { field: 'country', equals: 'US' } }, context)).toBe(false);
  });

  it('uses strict scalar equality and membership checks', () => {
    expect(evaluateCondition({ field: 'age', equals: 18 }, context)).toBe(true);
    expect(evaluateCondition({ field: 'age', equals: '18' }, context)).toBe(false);
    expect(evaluateCondition({ field: 'country', in: ['US', 'CA'] }, context)).toBe(true);
    expect(evaluateCondition({ field: 'age', in: [18, 20] }, context)).toBe(true);
    expect(evaluateCondition({ field: 'age', in: [19, 20] }, context)).toBe(false);
  });

  it('distinguishes missing values from explicit null and supports isSet', () => {
    expect(evaluateCondition({ field: 'missing', equals: null }, context)).toBe(false);
    expect(evaluateCondition({ field: 'presentNull', equals: null }, context)).toBe(true);
    expect(evaluateCondition({ field: 'presentNull', isSet: true }, context)).toBe(true);
    expect(evaluateCondition({ field: 'missing', isSet: false }, context)).toBe(true);
    expect(evaluateCondition({ field: 'presentNull', isSet: false }, context)).toBe(false);
  });

  it('collects referenced field names recursively', () => {
    expect(
      collectConditionReferences({
        all: [{ field: 'country', equals: 'US' }, { not: { field: 'age', in: [18, 20] } }],
      }),
    ).toEqual(['country', 'age']);
  });

  describe('score condition leaf', () => {
    const scores = { risk: 50 };

    it('evaluates gte at, above, and below the threshold', () => {
      expect(evaluateCondition({ score: 'risk', gte: 50 }, context, scores)).toBe(true);
      expect(evaluateCondition({ score: 'risk', gte: 40 }, context, scores)).toBe(true);
      expect(evaluateCondition({ score: 'risk', gte: 60 }, context, scores)).toBe(false);
    });

    it('evaluates gt at, above, and below the threshold', () => {
      expect(evaluateCondition({ score: 'risk', gt: 50 }, context, scores)).toBe(false);
      expect(evaluateCondition({ score: 'risk', gt: 40 }, context, scores)).toBe(true);
      expect(evaluateCondition({ score: 'risk', gt: 60 }, context, scores)).toBe(false);
    });

    it('evaluates lte at, above, and below the threshold', () => {
      expect(evaluateCondition({ score: 'risk', lte: 50 }, context, scores)).toBe(true);
      expect(evaluateCondition({ score: 'risk', lte: 40 }, context, scores)).toBe(false);
      expect(evaluateCondition({ score: 'risk', lte: 60 }, context, scores)).toBe(true);
    });

    it('evaluates lt at, above, and below the threshold', () => {
      expect(evaluateCondition({ score: 'risk', lt: 50 }, context, scores)).toBe(false);
      expect(evaluateCondition({ score: 'risk', lt: 40 }, context, scores)).toBe(false);
      expect(evaluateCondition({ score: 'risk', lt: 60 }, context, scores)).toBe(true);
    });

    it('resolves a score leaf nested inside all, any and not', () => {
      expect(
        evaluateCondition(
          {
            all: [
              { score: 'risk', gte: 50 },
              { field: 'country', equals: 'US' },
            ],
          },
          context,
          scores,
        ),
      ).toBe(true);

      expect(
        evaluateCondition(
          {
            any: [
              { score: 'risk', gte: 60 },
              { field: 'country', equals: 'CA' },
            ],
          },
          context,
          scores,
        ),
      ).toBe(false);

      expect(evaluateCondition({ not: { score: 'risk', gte: 60 } }, context, scores)).toBe(true);
    });

    it('returns false when the named score is missing from the map', () => {
      expect(evaluateCondition({ score: 'missing', gte: 0 }, context, scores)).toBe(false);
    });

    it('returns false when no scores argument is provided at all', () => {
      expect(evaluateCondition({ score: 'risk', gte: 0 }, context)).toBe(false);
    });
  });
});
