import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api/api-error';
import { fetchPlatformUsers, fetchSuperadmins, isSuperadmin, setUserRole } from './platform';

const { mockedListUsers, mockedSetRole, mockedNotify } = vi.hoisted(() => ({
  mockedNotify: vi.fn(),
  mockedListUsers: vi.fn(),
  mockedSetRole: vi.fn(),
}));

vi.mock('@/services/auth/auth-client', () => ({
  authClient: {
    admin: { listUsers: mockedListUsers, setRole: mockedSetRole },
    $store: { notify: mockedNotify },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('platform', () => {
  it('lists a page of users, searching the email only when asked', async () => {
    mockedListUsers.mockResolvedValue({ data: { users: [], total: 0 }, error: null });

    await fetchPlatformUsers({ search: 'ann', page: 3, pageSize: 20 });
    await fetchPlatformUsers({ search: '', page: 1, pageSize: 20 });

    expect(mockedListUsers).toHaveBeenNthCalledWith(1, {
      query: {
        searchValue: 'ann',
        searchField: 'email',
        searchOperator: 'contains',
        limit: 20,
        offset: 40,
        sortBy: 'createdAt',
        sortDirection: 'desc',
      },
    });
    expect(mockedListUsers.mock.calls[1][0].query).not.toHaveProperty('searchValue');
  });

  it('reads the superadmins by their role', async () => {
    mockedListUsers.mockResolvedValue({ data: { users: [{ id: 'u-1' }], total: 1 }, error: null });

    await expect(fetchSuperadmins()).resolves.toEqual([{ id: 'u-1' }]);
    expect(mockedListUsers.mock.calls[0][0].query).toMatchObject({
      filterField: 'role',
      filterValue: 'superadmin',
    });
  });

  it('refreshes the session after a role change, which may be the operator own', async () => {
    mockedSetRole.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });

    await setUserRole('u-1', 'user');

    expect(mockedNotify).toHaveBeenCalledWith('$sessionSignal');
  });

  it('turns a refusal into an ApiError carrying its status', async () => {
    mockedSetRole.mockResolvedValue({
      data: null,
      error: { message: 'At least one active superadmin must remain.', status: 403 },
    });

    const failure = await setUserRole('u-1', 'user').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(mockedNotify).not.toHaveBeenCalled();
    expect(failure).toMatchObject({
      message: 'At least one active superadmin must remain.',
      status: 403,
    });
  });

  it('recognises a superadmin among several comma-separated roles', () => {
    expect(isSuperadmin({ role: 'user,superadmin' })).toBe(true);
    expect(isSuperadmin({ role: 'user' })).toBe(false);
    expect(isSuperadmin({ role: null })).toBe(false);
  });
});
