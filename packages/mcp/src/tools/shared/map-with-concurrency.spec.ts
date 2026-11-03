import { mapWithConcurrency } from './map-with-concurrency';

describe('mapWithConcurrency', () => {
  it('never has more than the limit in flight and keeps the input order', async () => {
    let running = 0;
    let peak = 0;

    const results = await mapWithConcurrency([5, 1, 4, 2, 3, 6, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, n));
      running--;

      return n * 2;
    });

    expect(results).toEqual([10, 2, 8, 4, 6, 12, 14]);
    expect(peak).toBe(3);
  });

  it('is empty for no items', async () => {
    expect(await mapWithConcurrency([], 3, () => Promise.resolve(1))).toEqual([]);
  });

  it('starts nothing new after a failure and rejects with it', async () => {
    const started: number[] = [];

    await expect(
      mapWithConcurrency([1, 2, 3, 4, 5], 1, (n) => {
        started.push(n);

        return n === 2 ? Promise.reject(new Error('boom')) : Promise.resolve(n);
      }),
    ).rejects.toThrow('boom');
    expect(started).toEqual([1, 2]);
  });
});
