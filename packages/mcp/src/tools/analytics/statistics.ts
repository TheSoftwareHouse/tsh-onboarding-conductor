/** Min, median and max of the numbers a group holds. */
export interface Spread {
  count: number;
  min: number;
  median: number;
  max: number;
}

/** The middle value, or the mean of the two middle values; `undefined` when there are none. */
export function findMedian(values: readonly number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function findSpread(values: readonly number[]): Spread | undefined {
  const median = findMedian(values);

  if (median === undefined) {
    return undefined;
  }

  // A loop, not `Math.min(...values)`: spreading a large array overflows the call stack.
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  return { count: values.length, min, median, max };
}
