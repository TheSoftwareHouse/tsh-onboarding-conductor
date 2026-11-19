import { mutationOptions } from '@/services/query-client/mutation-options';
import {
  acceptInvitation,
  cancelInvitation,
  inviteMember,
  removeMember,
  signUpInvitee,
  updateMemberRole,
  type InviteeSignUp,
  type OrganizationRole,
} from './organization';
import { organizationQueries } from './organization-queries';

const refreshOrganization = () => [organizationQueries.active().queryKey] as const;

/** Sibling module to `organization.ts` on purpose, so `vi.mock('@/api/organization/organization')` still intercepts the cross-module `mutationFn` calls. */
export const organizationMutations = {
  invite: () =>
    mutationOptions({
      mutationFn: (variables: { email: string; role: OrganizationRole }) =>
        inviteMember(variables.email, variables.role),
      meta: { awaits: refreshOrganization },
    }),
  cancelInvitation: () =>
    mutationOptions({
      mutationFn: (invitationId: string) => cancelInvitation(invitationId),
      meta: { awaits: refreshOrganization },
    }),
  updateRole: () =>
    mutationOptions({
      mutationFn: (variables: { memberId: string; role: OrganizationRole }) =>
        updateMemberRole(variables.memberId, variables.role),
      meta: { awaits: refreshOrganization },
    }),
  removeMember: () =>
    mutationOptions({
      mutationFn: (memberId: string) => removeMember(memberId),
      meta: { awaits: refreshOrganization },
    }),
  acceptInvitation: () =>
    mutationOptions({
      mutationFn: (invitationId: string) => acceptInvitation(invitationId),
    }),
  signUpInvitee: () =>
    mutationOptions({
      mutationFn: (values: InviteeSignUp) => signUpInvitee(values),
    }),
};
