import type { ReactElement } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryProvider } from './QueryProvider';

afterEach(() => {
  cleanup();
});

let client: QueryClient;

function Reader({
  queryKey,
  queryFn,
}: {
  queryKey: string;
  queryFn: () => Promise<string>;
}): ReactElement {
  client = useQueryClient();
  const { data } = useQuery({ queryKey: [queryKey], queryFn });
  return <p>{data ?? 'loading'}</p>;
}

/** Mounts a reader, waits for its first read, then unmounts it so its cache entry goes inactive. */
async function readOnceAndLeave(queryKey: string, queryFn: () => Promise<string>): Promise<void> {
  const { unmount } = render(
    <QueryProvider>
      <Reader queryKey={queryKey} queryFn={queryFn} />
    </QueryProvider>,
  );
  await screen.findByText('read');
  unmount();
}

function remount(queryKey: string, queryFn: () => Promise<string>): void {
  render(
    <QueryProvider>
      <Reader queryKey={queryKey} queryFn={queryFn} />
    </QueryProvider>,
  );
}

describe('QueryProvider', () => {
  it('serves a remounted query from its cache without refetching', async () => {
    const queryFn = vi.fn().mockResolvedValue('read');
    await readOnceAndLeave('fresh', queryFn);

    remount('fresh', queryFn);

    await screen.findByText('read');
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('refetches a query invalidated while unmounted once it mounts again', async () => {
    const queryFn = vi.fn().mockResolvedValue('read');
    await readOnceAndLeave('invalidated', queryFn);
    await client.invalidateQueries({ queryKey: ['invalidated'] });

    remount('invalidated', queryFn);

    await waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(2);
    });
  });
});
