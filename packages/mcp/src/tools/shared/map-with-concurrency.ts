/**
 * `map` over `items` with at most `limit` calls in flight; results keep the order of `items`. After
 * the first failure no further item is started, and that failure is what the call rejects with.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  map: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;

  const work = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next++;

      try {
        results[index] = await map(items[index]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, work));

  return results;
}
