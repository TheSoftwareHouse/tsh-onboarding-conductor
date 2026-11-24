import { ApiError } from '@/services/api/api-error';
import { authClient } from '@/services/auth/auth-client';
import { unwrap } from '@/services/auth/unwrap-auth-result';

/** The roles an organization member can hold, least to most privileged. */
export const ORGANIZATION_ROLES = ['member', 'admin', 'owner'] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

/** The active organization with its members and invitations; `null` while the session has none. */
export async function fetchActiveOrganization() {
  const { data, error } = await authClient.organization.getFullOrganization();
  if (error) {
    throw new ApiError(error.message ?? 'Unable to load the organization.', {
      status: error.status,
      code: error.code,
    });
  }
  return data;
}

export type ActiveOrganization = NonNullable<Awaited<ReturnType<typeof fetchActiveOrganization>>>;
export type OrganizationMember = ActiveOrganization['members'][number];
export type OrganizationInvitation = ActiveOrganization['invitations'][number];

export function inviteMember(email: string, role: OrganizationRole) {
  return unwrap(
    authClient.organization.inviteMember({ email, role }),
    'Unable to send the invitation.',
  );
}

export function cancelInvitation(invitationId: string) {
  return unwrap(
    authClient.organization.cancelInvitation({ invitationId }),
    'Unable to cancel the invitation.',
  );
}

export function updateMemberRole(memberId: string, role: OrganizationRole) {
  return unwrap(
    authClient.organization.updateMemberRole({ memberId, role }),
    'Unable to change the role.',
  );
}

export function removeMember(memberIdOrEmail: string) {
  return unwrap(
    authClient.organization.removeMember({ memberIdOrEmail }),
    'Unable to remove the member.',
  );
}

export function acceptInvitation(invitationId: string) {
  return unwrap(
    authClient.organization.acceptInvitation({ invitationId }),
    'Unable to accept the invitation.',
  );
}

export interface InviteeSignUp {
  name: string;
  email: string;
  password: string;
  /**
   * The id from the mailed invitation link. The engine creates the account only when it names a
   * pending invitation for this address, so knowing the address alone cannot claim it.
   */
  invitationId: string;
}

export function signUpInvitee(values: InviteeSignUp) {
  return unwrap(authClient.signUp.email(values), 'Unable to create the account.');
}
