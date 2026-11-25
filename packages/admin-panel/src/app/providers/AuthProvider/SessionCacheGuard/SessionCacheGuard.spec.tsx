import {
  MutationObserver,
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionCacheGuard } from './SessionCacheGuard';

const { mockedUseSession, mockedNotify } = vi.hoisted(() => ({
  mockedUseSession: vi.fn(),
  mockedNotify: vi.fn(),
}));

vi.mock('@/services/auth/auth-client', () => ({
  authClient: { useSession: mockedUseSession, $store: { notify: mockedNotify } },
}));

interface SessionState {
  data: {
    user: { id: string; role?: string | null };
    session: { activeOrganizationId?: string | null };
  } | null;
  isPending: boolean;
}

function signedIn(userId: string, organizationId = 'org-1', role = 'user'): SessionState {
  return {
    data: { user: { id: userId, role }, session: { activeOrganizationId: organizationId } },
    isPending: false,
  };
}

const SIGNED_OUT: SessionState = { data: null, isPending: false };
const LOADING: SessionState = { data: null, isPending: true };

let client: QueryClient;

function renderGuard(state: SessionState) {
  mockedUseSession.mockReturnValue(state);
  const view = render(
    <QueryClientProvider client={client}>
      <SessionCacheGuard />
    </QueryClientProvider>,
  );

  return {
    update(next: SessionState) {
      mockedUseSession.mockReturnValue(next);
      view.rerender(
        <QueryClientProvider client={client}>
          <SessionCacheGuard />
        </QueryClientProvider>,
      );
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient();
  client.setQueryData(['onboardings'], ['previous operator data']);
});

afterEach(() => {
  cleanup();
  client.clear();
});

describe('SessionCacheGuard', () => {
  it('keeps the cache through the first session read', () => {
    const view = renderGuard(LOADING);
    view.update(signedIn('u-1'));

    expect(client.getQueryData(['onboardings'])).toEqual(['previous operator data']);
  });

  it('keeps the cache while the same session is re-read', () => {
    const view = renderGuard(signedIn('u-1'));
    view.update({ ...signedIn('u-1'), isPending: true });
    view.update(signedIn('u-1'));

    expect(client.getQueryData(['onboardings'])).toEqual(['previous operator data']);
    expect(mockedNotify).not.toHaveBeenCalled();
  });

  it('clears the cache when the session ends', () => {
    const view = renderGuard(signedIn('u-1'));
    view.update(SIGNED_OUT);

    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it.each([
    ['another operator signs in', signedIn('u-2')],
    ['the active organization changes', signedIn('u-1', 'org-2')],
    ['the platform role changes', signedIn('u-1', 'org-1', 'superadmin')],
  ])('drops the cached data and refreshes the organization list when %s', (_label, next) => {
    const view = renderGuard(signedIn('u-1'));
    view.update(next);

    expect(client.getQueryData(['onboardings'])).toBeUndefined();
    expect(mockedNotify).toHaveBeenCalledWith('$listOrg');
  });

  it('drops data cached before a sign-in', () => {
    const view = renderGuard(SIGNED_OUT);
    view.update(signedIn('u-1'));

    expect(client.getQueryData(['onboardings'])).toBeUndefined();
  });

  it('keeps the cache while a re-read passes through an empty, pending state', () => {
    const view = renderGuard(signedIn('u-1'));
    view.update(LOADING);
    view.update(signedIn('u-1'));

    expect(client.getQueryData(['onboardings'])).toEqual(['previous operator data']);
  });

  it('clears on sign-out and starts clean for the operator who signs in next', () => {
    const view = renderGuard(signedIn('u-1'));
    view.update(SIGNED_OUT);
    client.setQueryData(['sign-in-screen'], 'fetched while signed out');
    view.update(signedIn('u-2'));

    expect(
      client
        .getQueryCache()
        .getAll()
        .every((query) => query.state.data === undefined),
    ).toBe(true);
    expect(mockedNotify).toHaveBeenCalledTimes(1);
  });

  it('also forgets the mutations of the session that ended', async () => {
    const view = renderGuard(signedIn('u-1'));
    await new MutationObserver(client, { mutationFn: () => Promise.resolve('saved') }).mutate();
    expect(client.getMutationCache().getAll()).toHaveLength(1);

    view.update(SIGNED_OUT);

    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });

  it('fetches the reads on screen again for the new scope', async () => {
    const queryFn = vi.fn(() => Promise.resolve('fresh'));
    const unsubscribe = new QueryObserver(client, { queryKey: ['on-screen'], queryFn }).subscribe(
      () => undefined,
    );
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
    const view = renderGuard(signedIn('u-1'));

    view.update(signedIn('u-1', 'org-2'));

    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    unsubscribe();
  });

  it('acts once per change, not on every render of the same session', () => {
    const view = renderGuard(signedIn('u-1'));
    view.update(signedIn('u-2'));
    view.update(signedIn('u-2'));
    view.update(signedIn('u-2'));

    expect(mockedNotify).toHaveBeenCalledTimes(1);
  });
});
