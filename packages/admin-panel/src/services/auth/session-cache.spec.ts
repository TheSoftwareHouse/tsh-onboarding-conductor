import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleUnauthorized, readSessionScope } from './session-cache';

const { mockedNotify, mockedIsAuthEnabled } = vi.hoisted(() => ({
  mockedNotify: vi.fn(),
  mockedIsAuthEnabled: vi.fn(),
}));

vi.mock('./auth-client', () => ({ authClient: { $store: { notify: mockedNotify } } }));
vi.mock('./auth-config', () => ({ isAuthEnabled: mockedIsAuthEnabled }));

describe('readSessionScope', () => {
  const session = {
    user: { id: 'u-1', role: 'superadmin' },
    session: { activeOrganizationId: 'org-1' },
  };

  it('is null without a session', () => {
    expect(readSessionScope(null)).toBeNull();
    expect(readSessionScope(undefined)).toBeNull();
  });

  it('changes with the operator, the platform role and the active organization', () => {
    const scope = readSessionScope(session);

    expect(readSessionScope({ ...session, user: { id: 'u-2', role: 'superadmin' } })).not.toBe(
      scope,
    );
    expect(readSessionScope({ ...session, user: { id: 'u-1', role: 'user' } })).not.toBe(scope);
    expect(readSessionScope({ ...session, session: { activeOrganizationId: 'org-2' } })).not.toBe(
      scope,
    );
    expect(readSessionScope({ ...session })).toBe(scope);
  });
});

describe('handleUnauthorized', () => {
  let client: QueryClient;
  let unsubscribe: () => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockedIsAuthEnabled.mockReturnValue(true);
    client = new QueryClient();
    await client.fetchQuery({ queryKey: ['other-page'], queryFn: () => 'cached' });
    unsubscribe = new QueryObserver(client, {
      queryKey: ['on-screen'],
      queryFn: () => 'shown',
    }).subscribe(() => undefined);
  });

  afterEach(() => {
    unsubscribe();
    client.clear();
  });

  it('drops the reads not on screen and re-reads the session', () => {
    handleUnauthorized(client);

    expect(client.getQueryCache().find({ queryKey: ['other-page'] })).toBeUndefined();
    expect(client.getQueryCache().find({ queryKey: ['on-screen'] })).toBeDefined();
    expect(mockedNotify).toHaveBeenCalledWith('$sessionSignal');
  });

  it('does nothing while sign-in is off', () => {
    mockedIsAuthEnabled.mockReturnValue(false);

    handleUnauthorized(client);

    expect(client.getQueryData(['other-page'])).toBe('cached');
    expect(mockedNotify).not.toHaveBeenCalled();
  });
});
