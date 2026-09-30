import { describe, expect, it } from 'vitest';
import { describeCondition } from './describe-condition';

describe('describeCondition', () => {
  it('renders equals, in and isSet leaves', () => {
    expect(describeCondition({ field: 'documentType', equals: 'PASSPORT' })).toBe(
      'documentType = PASSPORT',
    );
    expect(describeCondition({ field: 'kind', in: ['a', 'b'] })).toBe('kind in a, b');
    expect(describeCondition({ field: 'x', isSet: true })).toBe('x is set');
    expect(describeCondition({ field: 'x', isSet: false })).toBe('x is not set');
  });

  it('renders score comparisons', () => {
    expect(describeCondition({ score: 'risk', gte: 5 })).toBe('score risk ≥ 5');
    expect(describeCondition({ score: 'risk', gt: 5 })).toBe('score risk > 5');
    expect(describeCondition({ score: 'risk', lte: 5 })).toBe('score risk ≤ 5');
    expect(describeCondition({ score: 'risk', lt: 5 })).toBe('score risk < 5');
  });

  it('joins all and any and wraps not', () => {
    const a = { field: 'a', equals: 1 };
    const b = { field: 'b', equals: true };
    expect(describeCondition({ all: [a, b] })).toBe('a = 1 and b = true');
    expect(describeCondition({ any: [a, b] })).toBe('a = 1 or b = true');
    expect(describeCondition({ not: a })).toBe('not (a = 1)');
    expect(describeCondition({ all: [a, { any: [a, b] }] })).toBe('a = 1 and (a = 1 or b = true)');
  });

  it('never throws on malformed input', () => {
    for (const malformed of [
      undefined,
      null,
      'x',
      42,
      [],
      {},
      { all: 'nope' },
      { all: [] },
      { field: 3, equals: 1 },
      { field: 'f' },
      { score: 'risk' },
      { all: [null, { not: 7 }] },
    ]) {
      expect(() => describeCondition(malformed)).not.toThrow();
    }
    expect(describeCondition({ foo: 1 })).toBe('custom condition');
    expect(describeCondition(undefined)).toBe('custom condition');
  });
});
