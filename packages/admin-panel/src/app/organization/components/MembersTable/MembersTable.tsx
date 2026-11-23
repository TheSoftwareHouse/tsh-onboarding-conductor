import type { ReactElement } from 'react';
import { useMutation } from '@tanstack/react-query';
import { organizationMutations } from '@/api/organization/organization-mutations';
import {
  ORGANIZATION_ROLES,
  type OrganizationMember,
  type OrganizationRole,
} from '@/api/organization/organization';
import { Button } from '@/components/ui/Button/Button';
import { Table, Td, Th } from '@/components/ui/DataTable/DataTable';
import { Select } from '@/components/ui/Select/Select';
import { showErrorToast, showSuccessToast } from '@/components/ui/Toast/toast-manager';

export interface MembersTableProps {
  members: readonly OrganizationMember[];
}

const ROLE_ITEMS = ORGANIZATION_ROLES.map((role) => ({ value: role, label: role }));

/** The organization's members, each with a role picker and a remove action. The engine judges who may do either. */
export function MembersTable({ members }: MembersTableProps): ReactElement {
  const updateRole = useMutation(organizationMutations.updateRole());
  const removeMember = useMutation(organizationMutations.removeMember());
  const isBusy = updateRole.isPending || removeMember.isPending;

  const handleRoleChange = (member: OrganizationMember, role: OrganizationRole): void => {
    if (role === member.role) return;
    updateRole.mutate(
      { memberId: member.id, role },
      {
        onSuccess: () => showSuccessToast(`${member.user.email} is now ${role}`),
        onError: (error) => showErrorToast('Role not changed', error.message),
      },
    );
  };

  const handleRemove = (member: OrganizationMember): void => {
    removeMember.mutate(member.id, {
      onSuccess: () => showSuccessToast(`${member.user.email} removed`),
      onError: (error) => showErrorToast('Member not removed', error.message),
    });
  };

  return (
    <Table caption="Organization members">
      <thead>
        <tr>
          <Th>Name</Th>
          <Th>Email</Th>
          <Th>Role</Th>
          <Th align="end">
            <span className="sr-only">Actions</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {members.map((member) => (
          <tr key={member.id}>
            <Td>{member.user.name}</Td>
            <Td variant="mono">{member.user.email}</Td>
            <Td>
              <Select
                aria-label={`Role of ${member.user.email}`}
                items={ROLE_ITEMS}
                value={member.role as OrganizationRole}
                onValueChange={(role) => handleRoleChange(member, role)}
                disabled={isBusy}
              />
            </Td>
            <Td variant="end">
              <Button
                variant="danger"
                size="sm"
                aria-label={`Remove ${member.user.email}`}
                disabled={isBusy}
                onClick={() => handleRemove(member)}
              >
                Remove
              </Button>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
