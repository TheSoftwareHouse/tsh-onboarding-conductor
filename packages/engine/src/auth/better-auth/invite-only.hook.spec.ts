import { isUserCreationAllowed, type InvitationRecord } from './invite-only.hook';

const NOW = new Date('2026-01-10T12:00:00Z');
const FUTURE = new Date('2026-01-11T12:00:00Z');
const PAST = new Date('2026-01-09T12:00:00Z');

const lookupsReturning = (...invitations: InvitationRecord[]) => ({
  findInvitations: jest.fn().mockResolvedValue(invitations),
});

describe('isUserCreationAllowed', () => {
  it('allows an HTTP sign-up that holds a pending, unexpired invitation', async () => {
    const lookups = lookupsReturning({ status: 'pending', expiresAt: FUTURE });

    await expect(isUserCreationAllowed('a@x.io', false, lookups, NOW)).resolves.toBe(true);
    expect(lookups.findInvitations).toHaveBeenCalledWith('a@x.io');
  });

  it('allows a server-side creation without looking anything up', async () => {
    const lookups = lookupsReturning();

    await expect(isUserCreationAllowed('a@x.io', true, lookups, NOW)).resolves.toBe(true);
    expect(lookups.findInvitations).not.toHaveBeenCalled();
  });

  it('refuses an HTTP sign-up with no invitation', async () => {
    await expect(isUserCreationAllowed('a@x.io', false, lookupsReturning(), NOW)).resolves.toBe(
      false,
    );
  });

  it.each([
    ['expired', { status: 'pending', expiresAt: PAST }],
    ['accepted', { status: 'accepted', expiresAt: FUTURE }],
    ['canceled', { status: 'canceled', expiresAt: FUTURE }],
  ])('refuses an HTTP sign-up whose only invitation is %s', async (_label, invitation) => {
    await expect(
      isUserCreationAllowed('a@x.io', false, lookupsReturning(invitation), NOW),
    ).resolves.toBe(false);
  });
});
