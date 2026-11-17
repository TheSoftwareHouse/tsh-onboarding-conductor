import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  banUser,
  createOrganization,
  revokeUserSessions,
  setUserPassword,
  setUserRole,
  unbanUser,
} from './platform';
import { platformMutations } from './platform-mutations';
import { platformQueries } from './platform-queries';

vi.mock('./platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./platform')>()),
  setUserRole: vi.fn(),
  banUser: vi.fn(),
  unbanUser: vi.fn(),
  revokeUserSessions: vi.fn(),
  setUserPassword: vi.fn(),
  createOrganization: vi.fn(),
}));

const CONTEXT = { client: undefined as never, meta: undefined };

function keysOf(awaits: unknown): unknown {
  return typeof awaits === 'function' ? awaits(undefined, undefined) : awaits;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('platformMutations', () => {
  it('refreshes every user read after a role, ban or unban write', () => {
    for (const write of [
      platformMutations.setRole(),
      platformMutations.ban(),
      platformMutations.unban(),
    ]) {
      expect(keysOf(write.meta?.awaits)).toEqual([platformQueries.users()]);
    }
  });

  it('refreshes the organizations after one is created', () => {
    expect(keysOf(platformMutations.createOrganization().meta?.awaits)).toEqual([
      platformQueries.organizations().queryKey,
    ]);
  });

  it('declares no meta on the session and password writes', () => {
    expect(platformMutations.revokeSessions().meta).toBeUndefined();
    expect(platformMutations.setPassword().meta).toBeUndefined();
  });

  it('crosses the module boundary with each write', async () => {
    await platformMutations.setRole().mutationFn?.({ userId: 'u-1', role: 'superadmin' }, CONTEXT);
    await platformMutations.ban().mutationFn?.('u-1', CONTEXT);
    await platformMutations.unban().mutationFn?.('u-1', CONTEXT);
    await platformMutations.revokeSessions().mutationFn?.('u-1', CONTEXT);
    await platformMutations
      .setPassword()
      .mutationFn?.({ userId: 'u-1', password: 'temporary-1' }, CONTEXT);
    await platformMutations.createOrganization().mutationFn?.('Acme', CONTEXT);

    expect(setUserRole).toHaveBeenCalledWith('u-1', 'superadmin');
    expect(banUser).toHaveBeenCalledWith('u-1');
    expect(unbanUser).toHaveBeenCalledWith('u-1');
    expect(revokeUserSessions).toHaveBeenCalledWith('u-1');
    expect(setUserPassword).toHaveBeenCalledWith('u-1', 'temporary-1');
    expect(createOrganization).toHaveBeenCalledWith('Acme');
  });
});
