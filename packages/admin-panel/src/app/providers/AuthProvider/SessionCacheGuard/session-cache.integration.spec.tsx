import '@testing-library/jest-dom/vitest';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api/api-error';
import { handleUnauthorized } from '@/services/auth/session-cache';
import { createQueryClient } from '@/services/query-client/create-query-client';
import { SessionCacheGuard } from './SessionCacheGuard';

/**
 * The pieces wired as the app wires them — `createQueryClient` with `handleUnauthorized`, and the
 * guard beside a page — with only better-auth's session store replaced.
 */
const { session, mockedNotify } = vi.hoisted(() => ({
  session: { current: null as unknown },
  mockedNotify: vi.fn(),
}));

vi.mock('@/services/auth/auth-client', () => ({
  authClient: {
    useSession: () => ({ data: session.current, isPending: false }),
    $store: { notify: mockedNotify },
  },
}));
vi.mock('@/services/auth/auth-config', () => ({ isAuthEnabled: () => true }));

const OPERATOR = { user: { id: 'u-1', role: 'user' }, session: { activeOrganizationId: 'org-1' } };

function OnboardingsPage({ fetchRows }: { fetchRows: () => Promise<string[]> }) {
  const { data, error } = useQuery({ queryKey: ['onboardings'], queryFn: fetchRows });
  if (error) return <p>failed: {error.status}</p>;
  return <p>rows: {data?.join(', ') ?? 'none'}</p>;
}

function renderApp(
  fetchRows: () => Promise<string[]>,
  client = createQueryClient({ onUnauthorized: handleUnauthorized }),
) {
  const view = render(
    <QueryClientProvider client={client}>
      <SessionCacheGuard />
      {/* The gate: no page without a session. */}
      {session.current ? <OnboardingsPage fetchRows={fetchRows} /> : <p>sign in</p>}
    </QueryClientProvider>,
  );

  return {
    client,
    rerender: () =>
      view.rerender(
        <QueryClientProvider client={client}>
          <SessionCacheGuard />
          {/* The gate: no page without a session. */}
          {session.current ? <OnboardingsPage fetchRows={fetchRows} /> : <p>sign in</p>}
        </QueryClientProvider>,
      ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  session.current = OPERATOR;
});

afterEach(() => {
  cleanup();
});

describe('session cache, wired as in the app', () => {
  it('re-reads the session when a read gets a 401 and clears the cache once it is gone', async () => {
    const fetchRows = vi.fn(() => Promise.reject(new ApiError('Sign in again.', { status: 401 })));
    const { client, rerender } = renderApp(fetchRows);
    client.setQueryData(['workflows'], ['cached workflow']);

    expect(await screen.findByText('failed: 401')).toBeInTheDocument();
    expect(mockedNotify).toHaveBeenCalledWith('$sessionSignal');
    // The page that is not on screen goes at once; the failed one stays to explain itself.
    expect(client.getQueryData(['workflows'])).toBeUndefined();

    session.current = null;
    rerender();

    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it('leaves the cache alone on a 403, which a re-read of the session cannot fix', async () => {
    const fetchRows = vi.fn(() => Promise.reject(new ApiError('No access.', { status: 403 })));
    const { client } = renderApp(fetchRows);
    client.setQueryData(['workflows'], ['cached workflow']);

    expect(await screen.findByText('failed: 403')).toBeInTheDocument();
    expect(mockedNotify).not.toHaveBeenCalled();
    expect(client.getQueryData(['workflows'])).toEqual(['cached workflow']);
  });

  it("shows the next operator their own rows, never the previous operator's", async () => {
    const fetchRows = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(['row of u-1'])
      .mockResolvedValueOnce(['row of u-2']);
    const { rerender } = renderApp(fetchRows);
    expect(await screen.findByText('rows: row of u-1')).toBeInTheDocument();

    session.current = { ...OPERATOR, user: { id: 'u-2', role: 'user' } };
    rerender();

    await waitFor(() => expect(screen.getByText('rows: row of u-2')).toBeInTheDocument());
    expect(screen.queryByText(/row of u-1/)).not.toBeInTheDocument();
  });
});
