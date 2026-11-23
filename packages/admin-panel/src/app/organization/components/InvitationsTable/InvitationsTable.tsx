import type { ReactElement } from 'react';
import { useMutation } from '@tanstack/react-query';
import { organizationMutations } from '@/api/organization/organization-mutations';
import type { OrganizationInvitation } from '@/api/organization/organization';
import { Button } from '@/components/ui/Button/Button';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import { Table, Td, Th } from '@/components/ui/DataTable/DataTable';
import { showErrorToast, showSuccessToast } from '@/components/ui/Toast/toast-manager';

export interface InvitationsTableProps {
  /** Pending invitations only. */
  invitations: readonly OrganizationInvitation[];
}

/** Invitations still waiting for an answer, each with a cancel action. */
export function InvitationsTable({ invitations }: InvitationsTableProps): ReactElement {
  const cancel = useMutation(organizationMutations.cancelInvitation());

  const handleCancel = (invitation: OrganizationInvitation): void => {
    cancel.mutate(invitation.id, {
      onSuccess: () => showSuccessToast(`Invitation for ${invitation.email} cancelled`),
      onError: (error) => showErrorToast('Invitation not cancelled', error.message),
    });
  };

  return (
    <>
      <Table caption="Pending invitations">
        <thead>
          <tr>
            <Th>Email</Th>
            <Th>Role</Th>
            <Th>Expires</Th>
            <Th align="end">
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {invitations.map((invitation) => (
            <tr key={invitation.id}>
              <Td variant="mono">{invitation.email}</Td>
              <Td>{invitation.role}</Td>
              <Td variant="nowrap">{new Date(invitation.expiresAt).toLocaleDateString()}</Td>
              <Td variant="end">
                <Button
                  variant="danger"
                  size="sm"
                  aria-label={`Cancel invitation for ${invitation.email}`}
                  disabled={cancel.isPending}
                  onClick={() => handleCancel(invitation)}
                >
                  Cancel
                </Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {invitations.length === 0 && <EmptyState layout="section" title="No pending invitations" />}
    </>
  );
}
