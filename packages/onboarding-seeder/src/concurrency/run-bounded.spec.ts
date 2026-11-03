import { runBounded } from './run-bounded';

describe('runBounded', () => {
  it('never runs more than the limit at once and keeps the order of the items', async () => {
    let inFlight = 0;
    let peak = 0;

    const results = await runBounded([1, 2, 3, 4, 5, 6], 2, async (item) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight--;

      return item * 10;
    });

    expect(peak).toBe(2);
    expect(results).toEqual(
      [10, 20, 30, 40, 50, 60].map((value) => ({ status: 'fulfilled', value })),
    );
  });

  it('settles every item when one fails', async () => {
    const results = await runBounded([1, 2, 3], 2, async (item) => {
      if (item === 2) {
        throw new Error('boom');
      }

      return item;
    });

    expect(results.map(({ status }) => status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });
});
