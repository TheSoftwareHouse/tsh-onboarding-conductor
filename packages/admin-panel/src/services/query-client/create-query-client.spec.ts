import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  MutationObserver,
  QueryObserver,
  type DefaultError,
  type MutationMeta,
  type QueryClient,
} from '@tanstack/react-query';
import { createQueryClient } from './create-query-client';
import type { ApiError } from '@/services/api/api-error';
import { mutationOptions, type AppMutationMeta, type InvalidationMeta } from './mutation-options';

interface Deferred {
  promise: Promise<string>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<string>((res) => {
    resolve = () => res('fresh');
  });
  return { promise, resolve };
}

describe('react-query registration', () => {
  it('resolves the registered error and meta types', () => {
    expectTypeOf<DefaultError>().toEqualTypeOf<ApiError>();
    expectTypeOf<MutationMeta>().toEqualTypeOf<AppMutationMeta<unknown, unknown>>();
  });
});

describe('createQueryClient', () => {
  let client: QueryClient;
  let unsubscribe: Array<() => void>;

  beforeEach(() => {
    client = createQueryClient();
    unsubscribe = [];
  });

  afterEach(() => {
    unsubscribe.forEach((fn) => fn());
    client.clear();
  });

  // Mounts an observer so the query counts as active and refetches on invalidation.
  async function watch(queryKey: unknown[], queryFn: () => Promise<string>): Promise<void> {
    const observer = new QueryObserver(client, { queryKey, queryFn, staleTime: Infinity });
    unsubscribe.push(observer.subscribe(() => undefined));
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
  }

  function run(
    meta: InvalidationMeta<string, number> | undefined,
    mutationFn: (variables: number) => Promise<string> = () => Promise.resolve('data'),
    onSuccess?: () => void,
  ): Promise<string> {
    const observer = new MutationObserver(client, mutationOptions({ mutationFn, meta, onSuccess }));
    return observer.mutate(7);
  }

  it('keeps the four query defaults', () => {
    const defaults = client.getDefaultOptions().queries;

    expect(defaults).toMatchObject({
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    });
    const refetchOnMount = defaults?.refetchOnMount as (query: unknown) => boolean;
    expect(refetchOnMount({ state: { isInvalidated: true } })).toBe(true);
    expect(refetchOnMount({ state: { isInvalidated: false } })).toBe(false);
  });

  it('invalidates static keys by prefix', async () => {
    const queryFn = vi.fn(() => Promise.resolve('x'));
    await watch(['lists', { page: 1 }], queryFn);

    await run({ invalidates: [['lists']] });

    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
  });

  it('passes data and variables to key functions', async () => {
    const invalidates = vi.fn((data: string, variables: number) => [[data, variables]] as const);
    const awaits = vi.fn((data: string, variables: number) => [[variables, data]] as const);

    await run({ invalidates, awaits });

    expect(invalidates).toHaveBeenCalledWith('data', 7);
    expect(awaits).toHaveBeenCalledWith('data', 7);
  });

  it('completes the awaited refetch before the mutation onSuccess runs', async () => {
    const gate = deferred();
    const events: string[] = [];
    let calls = 0;
    await watch(['doc'], () =>
      ++calls === 1
        ? Promise.resolve('old')
        : gate.promise.then((value) => {
            events.push('refetched');
            return value;
          }),
    );

    const done = run({ awaits: [['doc']] }, undefined, () => events.push('onSuccess'));
    await vi.waitFor(() => expect(calls).toBe(2));
    expect(events).toEqual([]);

    gate.resolve();
    await done;

    expect(events).toEqual(['refetched', 'onSuccess']);
    expect(client.getQueryData(['doc'])).toBe('fresh');
  });

  it('does not delay the mutation onSuccess for invalidates keys', async () => {
    const gate = deferred();
    let calls = 0;
    await watch(['doc'], () => (++calls === 1 ? Promise.resolve('old') : gate.promise));
    const onSuccess = vi.fn();

    await run({ invalidates: [['doc']] }, undefined, onSuccess);

    expect(calls).toBe(2);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(client.getQueryState(['doc'])?.fetchStatus).toBe('fetching');
    gate.resolve();
  });

  it('invalidates nothing without meta', async () => {
    const queryFn = vi.fn(() => Promise.resolve('x'));
    await watch(['lists'], queryFn);

    await run(undefined);

    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('invalidates nothing when the mutation fails', async () => {
    const queryFn = vi.fn(() => Promise.resolve('x'));
    await watch(['lists'], queryFn);

    await expect(
      run({ invalidates: [['lists']], awaits: [['lists']] }, () => Promise.reject(new Error('no'))),
    ).rejects.toThrow('no');

    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});
