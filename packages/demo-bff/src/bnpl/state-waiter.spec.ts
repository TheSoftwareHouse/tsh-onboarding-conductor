import { StateWaiter } from './state-waiter';

describe('StateWaiter', () => {
  const waiter = new StateWaiter();

  function counter(settleAt: number) {
    let calls = 0;
    return {
      fetch: async () => ++calls,
      isSettled: (value: number) => value >= settleAt,
      calls: () => calls,
    };
  }

  it('returns without sleeping when the first read is settled', async () => {
    const source = counter(1);

    await expect(waiter.waitFor('o1', { ...source, timeoutMs: 1000, pollMs: 1000 })).resolves.toBe(
      1,
    );
    expect(source.calls()).toBe(1);
  });

  it('re-reads on every poll tick until the value settles', async () => {
    const source = counter(3);

    await expect(waiter.waitFor('o1', { ...source, timeoutMs: 1000, pollMs: 5 })).resolves.toBe(3);
    expect(source.calls()).toBe(3);
  });

  it('wakes on a webhook long before the next tick', async () => {
    const source = counter(2);
    const started = Date.now();
    const waiting = waiter.waitFor('o1', { ...source, timeoutMs: 5000, pollMs: 5000 });

    await new Promise((resolve) => setImmediate(resolve));
    waiter.wake('o1');

    await expect(waiting).resolves.toBe(2);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('ignores a wake for another onboarding', async () => {
    const source = counter(Number.POSITIVE_INFINITY);
    const waiting = waiter.waitFor('o1', { ...source, timeoutMs: 60, pollMs: 1000 });

    await new Promise((resolve) => setImmediate(resolve));
    waiter.wake('other');

    // Only the timeout can end the sleep, so a second read still happens; a timer firing a
    // millisecond early may add a third, hence no exact count.
    await expect(waiting).resolves.toBeGreaterThanOrEqual(2);
    expect(source.calls()).toBeGreaterThanOrEqual(2);
  });

  it('returns the last value when the timeout passes', async () => {
    const source = counter(Number.POSITIVE_INFINITY);

    await expect(
      waiter.waitFor('o1', { ...source, timeoutMs: 30, pollMs: 10 }),
    ).resolves.toBeGreaterThan(1);
  });

  it('reads once and returns when the timeout is zero', async () => {
    const source = counter(Number.POSITIVE_INFINITY);

    await expect(waiter.waitFor('o1', { ...source, timeoutMs: 0, pollMs: 10 })).resolves.toBe(1);
    expect(source.calls()).toBe(1);
  });
});
