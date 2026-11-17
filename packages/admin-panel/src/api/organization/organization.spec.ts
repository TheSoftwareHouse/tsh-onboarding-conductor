import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api/api-error';
import { fetchActiveOrganization, inviteMember, removeMember } from './organization';

const { mockedGetFullOrganization, mockedInviteMember, mockedRemoveMember } = vi.hoisted(() => ({
  mockedGetFullOrganization: vi.fn(),
  mockedInviteMember: vi.fn(),
  mockedRemoveMember: vi.fn(),
}));

vi.mock('@/services/auth/auth-client', () => ({
  authClient: {
    organization: {
      getFullOrganization: mockedGetFullOrganization,
      inviteMember: mockedInviteMember,
      removeMember: mockedRemoveMember,
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('organization', () => {
  it('returns the data of a successful call', async () => {
    mockedInviteMember.mockResolvedValue({ data: { id: 'inv-1' }, error: null });

    await expect(inviteMember('a@tsh.io', 'member')).resolves.toEqual({ id: 'inv-1' });
    expect(mockedInviteMember).toHaveBeenCalledWith({ email: 'a@tsh.io', role: 'member' });
  });

  it('turns a refusal into an ApiError carrying its status and code', async () => {
    mockedRemoveMember.mockResolvedValue({
      data: null,
      error: { message: 'Not allowed', status: 403, code: 'ADMIN_PERMISSION_MISSING' },
    });

    const failure = await removeMember('m-1').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      message: 'Not allowed',
      status: 403,
      code: 'ADMIN_PERMISSION_MISSING',
    });
  });

  it('reads no organization as null, not as a failure', async () => {
    mockedGetFullOrganization.mockResolvedValue({ data: null, error: null });

    await expect(fetchActiveOrganization()).resolves.toBeNull();
  });

  it('turns a failed organization read into an ApiError', async () => {
    mockedGetFullOrganization.mockResolvedValue({
      data: null,
      error: { status: 403, code: 'TWO_FACTOR_REQUIRED' },
    });

    await expect(fetchActiveOrganization()).rejects.toMatchObject({
      status: 403,
      code: 'TWO_FACTOR_REQUIRED',
    });
  });
});
