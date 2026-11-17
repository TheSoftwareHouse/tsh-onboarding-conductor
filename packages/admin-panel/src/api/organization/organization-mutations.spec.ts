import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acceptInvitation,
  cancelInvitation,
  inviteMember,
  removeMember,
  signUpInvitee,
  updateMemberRole,
} from './organization';
import { organizationMutations } from './organization-mutations';
import { organizationQueries } from './organization-queries';

vi.mock('./organization', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./organization')>()),
  inviteMember: vi.fn(),
  cancelInvitation: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
  acceptInvitation: vi.fn(),
  signUpInvitee: vi.fn(),
}));

const CONTEXT = { client: undefined as never, meta: undefined };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('organizationMutations', () => {
  it('refreshes the active organization after each write to its members and invitations', () => {
    const writes = [
      organizationMutations.invite(),
      organizationMutations.cancelInvitation(),
      organizationMutations.updateRole(),
      organizationMutations.removeMember(),
    ];

    for (const write of writes) {
      const awaits = write.meta?.awaits;
      const keys = typeof awaits === 'function' ? awaits(undefined, undefined) : awaits;
      expect(keys).toEqual([organizationQueries.active().queryKey]);
    }
  });

  it('declares no meta on the sign-up and accept writes', () => {
    expect(organizationMutations.acceptInvitation().meta).toBeUndefined();
    expect(organizationMutations.signUpInvitee().meta).toBeUndefined();
  });

  it('invites across the module boundary', async () => {
    await organizationMutations
      .invite()
      .mutationFn?.({ email: 'a@tsh.io', role: 'admin' }, CONTEXT);

    expect(inviteMember).toHaveBeenCalledWith('a@tsh.io', 'admin');
  });

  it('cancels an invitation across the module boundary', async () => {
    await organizationMutations.cancelInvitation().mutationFn?.('inv-1', CONTEXT);

    expect(cancelInvitation).toHaveBeenCalledWith('inv-1');
  });

  it('changes a role across the module boundary', async () => {
    await organizationMutations
      .updateRole()
      .mutationFn?.({ memberId: 'm-1', role: 'owner' }, CONTEXT);

    expect(updateMemberRole).toHaveBeenCalledWith('m-1', 'owner');
  });

  it('removes a member across the module boundary', async () => {
    await organizationMutations.removeMember().mutationFn?.('m-1', CONTEXT);

    expect(removeMember).toHaveBeenCalledWith('m-1');
  });

  it('accepts an invitation across the module boundary', async () => {
    await organizationMutations.acceptInvitation().mutationFn?.('inv-1', CONTEXT);

    expect(acceptInvitation).toHaveBeenCalledWith('inv-1');
  });

  it('signs an invitee up across the module boundary', async () => {
    const values = { name: 'Ann', email: 'a@tsh.io', password: 'password-1' };

    await organizationMutations.signUpInvitee().mutationFn?.(values, CONTEXT);

    expect(signUpInvitee).toHaveBeenCalledWith(values);
  });
});
