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

  it('compares numbers with gte and lt at the boundary', () => {
    expect(evaluateCondition({ field: 'age', gte: 18 }, context)).toBe(true);
    expect(evaluateCondition({ field: 'age', gte: 19 }, context)).toBe(false);
    expect(evaluateCondition({ field: 'age', lt: 18 }, context)).toBe(false);
    expect(evaluateCondition({ field: 'age', lt: 19 }, context)).toBe(true);
  });

  it('treats a missing or non-numeric value as no match rather than an error', () => {
    expect(evaluateCondition({ field: 'missing', gte: 0 }, context)).toBe(false);
    expect(evaluateCondition({ field: 'missing', lt: 100 }, context)).toBe(false);
    expect(evaluateCondition({ field: 'country', gte: 0 }, context)).toBe(false);
    expect(evaluateCondition({ field: 'presentNull', lt: 100 }, context)).toBe(false);
  });

  it('composes gte and lt under all as a half-open band', () => {
    const band = (minimum: number, limit: number) => ({
      all: [
        { field: 'age', gte: minimum },
        { field: 'age', lt: limit },
      ],
    });

    expect(evaluateCondition(band(18, 30), context)).toBe(true);
    // The band is half-open, so its own lower bound matches and its upper bound does not.
    expect(evaluateCondition(band(18, 18), context)).toBe(false);
    expect(evaluateCondition(band(0, 18), context)).toBe(false);
    expect(evaluateCondition(band(19, 30), context)).toBe(false);
  });

  it('collects referenced field names recursively', () => {
    expect(
      collectConditionReferences({
        all: [{ field: 'country', equals: 'US' }, { not: { field: 'age', in: [18, 20] } }],
      }),
    ).toEqual(['country', 'age']);
  });
});
