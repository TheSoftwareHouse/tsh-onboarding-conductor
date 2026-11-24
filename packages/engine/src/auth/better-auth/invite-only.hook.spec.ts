import {
  judgeUserCreation,
  UserCreationVerdict,
  type InvitationRecord,
  type UserCreationAttempt,
} from './invite-only.hook';

const NOW = new Date('2026-01-10T12:00:00Z');
const FUTURE = new Date('2026-01-11T12:00:00Z');
const PAST = new Date('2026-01-09T12:00:00Z');

const INVITATION: InvitationRecord = { id: 'inv-1', status: 'pending', expiresAt: FUTURE };

const lookupsReturning = (...invitations: InvitationRecord[]) => ({
  findInvitations: jest.fn().mockResolvedValue(invitations),
});

function emailSignUp(invitationId: unknown): UserCreationAttempt {
  return { email: 'a@x.io', path: '/sign-up/email', invitationId };
}

const SOCIAL_SIGN_UP: UserCreationAttempt = {
  email: 'a@x.io',
  path: '/callback/:id',
  invitationId: undefined,
};

describe('judgeUserCreation', () => {
  it('allows a server-side creation without looking anything up', async () => {
    const lookups = lookupsReturning();

    await expect(
      judgeUserCreation({ email: 'a@x.io', path: null, invitationId: undefined }, lookups, NOW),
    ).resolves.toBe(UserCreationVerdict.ALLOWED);
    expect(lookups.findInvitations).not.toHaveBeenCalled();
  });

  describe('email sign-up', () => {
    it('allows one that names its pending invitation, and counts the address as proven', async () => {
      const lookups = lookupsReturning(INVITATION);

      await expect(judgeUserCreation(emailSignUp('inv-1'), lookups, NOW)).resolves.toBe(
        UserCreationVerdict.ALLOWED_EMAIL_PROVEN,
      );
      expect(lookups.findInvitations).toHaveBeenCalledWith('a@x.io');
    });

    it.each([
      ['no invitation id', undefined],
      ['an id that is not a string', 42],
      ["another address's invitation id", 'inv-of-someone-else'],
    ])('refuses one that knows the address but sends %s', async (_label, invitationId: unknown) => {
      await expect(
        judgeUserCreation(emailSignUp(invitationId), lookupsReturning(INVITATION), NOW),
      ).resolves.toBe(UserCreationVerdict.REFUSED);
    });

    it('refuses one with no invitation at all', async () => {
      await expect(judgeUserCreation(emailSignUp('inv-1'), lookupsReturning(), NOW)).resolves.toBe(
        UserCreationVerdict.REFUSED,
      );
    });

    it.each([
      ['expired', { ...INVITATION, expiresAt: PAST }],
      ['accepted', { ...INVITATION, status: 'accepted' }],
      ['canceled', { ...INVITATION, status: 'canceled' }],
    ])('refuses one whose named invitation is %s', async (_label, invitation) => {
      await expect(
        judgeUserCreation(emailSignUp('inv-1'), lookupsReturning(invitation), NOW),
      ).resolves.toBe(UserCreationVerdict.REFUSED);
    });
  });

  describe('social sign-up', () => {
    it('allows one whose address holds a pending invitation, without proving it here', async () => {
      await expect(
        judgeUserCreation(SOCIAL_SIGN_UP, lookupsReturning(INVITATION), NOW),
      ).resolves.toBe(UserCreationVerdict.ALLOWED);
    });

    it('refuses one with no pending, unexpired invitation', async () => {
      await expect(
        judgeUserCreation(
          SOCIAL_SIGN_UP,
          lookupsReturning({ ...INVITATION, expiresAt: PAST }),
          NOW,
        ),
      ).resolves.toBe(UserCreationVerdict.REFUSED);
    });
  });
});
