/** An invitation row, reduced to what decides whether its holder may create an account. */
export interface InvitationRecord {
  readonly id: string;
  readonly status: string;
  readonly expiresAt: Date;
}

export interface InviteOnlyLookups {
  findInvitations(email: string): Promise<readonly InvitationRecord[]>;
}

/** One attempt to create a user row, as `databaseHooks.user.create.before` sees it. */
export interface UserCreationAttempt {
  readonly email: string;
  /**
   * The better-auth endpoint the creation came through, or null for a direct `auth.api.*` call
   * (the superadmin seed, the admin `createUser`), which carries no HTTP request.
   */
  readonly path: string | null;
  /** What an email sign-up sent as `invitationId`: the id from the mailed invitation link. */
  readonly invitationId: unknown;
}

export enum UserCreationVerdict {
  REFUSED = 'refused',
  ALLOWED = 'allowed',
  /** Allowed, and the sign-up proved it holds the mailbox: it named the invitation mailed there. */
  ALLOWED_EMAIL_PROVEN = 'allowed_email_proven',
}

/** Fixed on purpose: it must not reveal whether an invitation exists for the address. */
export const INVITE_ONLY_REFUSAL_MESSAGE = 'Sign-up is by invitation only.';

const PENDING_INVITATION_STATUS = 'pending';
const EMAIL_SIGN_UP_PATH = '/sign-up/email';

/**
 * Whether a user row may be created.
 *
 * An email sign-up must name a pending, unexpired invitation for its own address by id. The id
 * travels only in the invitation email, so knowing the address is not enough: without this,
 * anyone who learned an invitee's address could register it first and accept the invitation as
 * them. A social sign-up (Microsoft) has no id to send; its provider vouches for the address, so
 * any pending invitation for it is enough. A server-side creation is the engine's own.
 */
export async function judgeUserCreation(
  attempt: UserCreationAttempt,
  lookups: InviteOnlyLookups,
  now: Date = new Date(),
): Promise<UserCreationVerdict> {
  if (attempt.path === null) {
    return UserCreationVerdict.ALLOWED;
  }

  const pending = (await lookups.findInvitations(attempt.email)).filter(
    (invitation) =>
      invitation.status === PENDING_INVITATION_STATUS &&
      invitation.expiresAt.getTime() > now.getTime(),
  );

  if (attempt.path !== EMAIL_SIGN_UP_PATH) {
    return pending.length > 0 ? UserCreationVerdict.ALLOWED : UserCreationVerdict.REFUSED;
  }

  const named = pending.some((invitation) => invitation.id === attempt.invitationId);

  return named ? UserCreationVerdict.ALLOWED_EMAIL_PROVEN : UserCreationVerdict.REFUSED;
}
