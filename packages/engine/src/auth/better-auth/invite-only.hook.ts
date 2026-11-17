/** An invitation row, reduced to what decides whether its holder may create an account. */
export interface InvitationRecord {
  readonly status: string;
  readonly expiresAt: Date;
}

export interface InviteOnlyLookups {
  findInvitations(email: string): Promise<readonly InvitationRecord[]>;
}

/** Fixed on purpose: it must not reveal whether an invitation exists for the address. */
export const INVITE_ONLY_REFUSAL_MESSAGE = 'Sign-up is by invitation only.';

const PENDING_INVITATION_STATUS = 'pending';

/**
 * Whether a user row may be created. Called from `databaseHooks.user.create.before`.
 *
 * `isServerSide` is true when the creation did not arrive over HTTP: the hook's endpoint context
 * carries a `request` only for a call that came through `toNodeHandler`, never for a direct
 * `auth.api.*` call such as the superadmin seed or the admin `createUser`.
 */
export async function isUserCreationAllowed(
  email: string,
  isServerSide: boolean,
  lookups: InviteOnlyLookups,
  now: Date = new Date(),
): Promise<boolean> {
  if (isServerSide) {
    return true;
  }

  const invitations = await lookups.findInvitations(email);

  return invitations.some(
    (invitation) =>
      invitation.status === PENDING_INVITATION_STATUS &&
      invitation.expiresAt.getTime() > now.getTime(),
  );
}
