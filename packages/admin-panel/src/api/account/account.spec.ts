import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api/api-error';
import { disableTwoFactor, fetchHasPassword } from './account';

const { mockedListAccounts, mockedDisable } = vi.hoisted(() => ({
  mockedListAccounts: vi.fn(),
  mockedDisable: vi.fn(),
}));

vi.mock('@/services/auth/auth-client', () => ({
  authClient: { listAccounts: mockedListAccounts, twoFactor: { disable: mockedDisable } },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('account', () => {
  it.each([
    [[{ providerId: 'credential' }, { providerId: 'microsoft' }], true],
    [[{ providerId: 'microsoft' }], false],
  ])('reads whether the operator has a password from %j', async (accounts, expected) => {
    mockedListAccounts.mockResolvedValue({ data: accounts, error: null });

    await expect(fetchHasPassword()).resolves.toBe(expected);
  });

  it('turns two-factor off with the password and reports a refusal as an ApiError', async () => {
    mockedDisable.mockResolvedValue({
      data: null,
      error: { message: 'Invalid password', status: 400 },
    });

    const failure = await disableTwoFactor('wrong').catch((error: unknown) => error);

    expect(mockedDisable).toHaveBeenCalledWith({ password: 'wrong' });
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ message: 'Invalid password', status: 400 });
  });
});
