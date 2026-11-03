import { findMedian, findSpread } from './statistics';

describe('findMedian', () => {
  it('is the middle value, or the mean of the two middle values', () => {
    expect(findMedian([3, 1, 2])).toBe(2);
    expect(findMedian([4, 1, 3, 2])).toBe(2.5);
  });

  it('is undefined without values and does not reorder its input', () => {
    const values = [3, 1, 2];

    expect(findMedian([])).toBeUndefined();
    findMedian(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe('findSpread', () => {
  it('reports count, min, median and max', () => {
    expect(findSpread([60, 80, 70])).toEqual({ count: 3, min: 60, median: 70, max: 80 });
  });

  it('is undefined without values', () => {
    expect(findSpread([])).toBeUndefined();
  });

  it('handles more values than a spread call can take', () => {
    const count = 500_000;
    const values = Array.from({ length: count }, (_, index) => index);

    expect(findSpread(values)).toEqual({
      count,
      min: 0,
      median: (count - 1) / 2,
      max: count - 1,
    });
  });
});
