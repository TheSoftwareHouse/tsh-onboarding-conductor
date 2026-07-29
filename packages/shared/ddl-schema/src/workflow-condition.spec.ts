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
});
