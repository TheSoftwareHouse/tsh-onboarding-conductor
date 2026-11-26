import type { ReactElement } from 'react';
import { useMutation } from '@tanstack/react-query';
import { platformMutations } from '@/api/platform/platform-mutations';
import {
  PLATFORM_ROLES,
  isSuperadmin,
  type PlatformRole,
  type PlatformUser,
} from '@/api/platform/platform';
import { Button } from '@/components/ui/Button/Button';
import { Chip } from '@/components/ui/Chip/Chip';
import { Table, Td, Th } from '@/components/ui/DataTable/DataTable';
import { Select } from '@/components/ui/Select/Select';
import { showErrorToast, showSuccessToast } from '@/components/ui/Toast/toast-manager';

export interface UsersTableProps {
  users: readonly PlatformUser[];
  /** Non-banned superadmins; `undefined` while unknown, when nothing is held back client-side. */
  activeSuperadminCount: number | undefined;
  onSetPassword: (user: PlatformUser) => void;
}

const ROLE_ITEMS = PLATFORM_ROLES.map((role) => ({ value: role, label: role }));

/**
 * The platform's users, each with a role picker and ban, revoke and password actions. The engine
 * refuses to demote or ban the last active superadmin, so the table does not offer it either.
 */
export function UsersTable({
  users,
  activeSuperadminCount,
  onSetPassword,
}: UsersTableProps): ReactElement {
  const setRole = useMutation(platformMutations.setRole());
  const ban = useMutation(platformMutations.ban());
  const unban = useMutation(platformMutations.unban());
  const revokeSessions = useMutation(platformMutations.revokeSessions());
  const isBusy = setRole.isPending || ban.isPending || unban.isPending || revokeSessions.isPending;

  const handleRoleChange = (user: PlatformUser, role: PlatformRole): void => {
    if (role === user.role) return;
    setRole.mutate(
      { userId: user.id, role },
      {
        onSuccess: () => showSuccessToast(`${user.email} is now ${role}`),
        onError: (error) => showErrorToast('Role not changed', error.message),
      },
    );
  };

  const handleBan = (user: PlatformUser): void => {
    ban.mutate(user.id, {
      onSuccess: () => showSuccessToast(`${user.email} banned`),
      onError: (error) => showErrorToast('User not banned', error.message),
    });
  };

  const handleUnban = (user: PlatformUser): void => {
    unban.mutate(user.id, {
      onSuccess: () => showSuccessToast(`${user.email} unbanned`),
      onError: (error) => showErrorToast('User not unbanned', error.message),
    });
  };

  const handleRevoke = (user: PlatformUser): void => {
    revokeSessions.mutate(user.id, {
      onSuccess: () => showSuccessToast(`Sessions of ${user.email} revoked`),
      onError: (error) => showErrorToast('Sessions not revoked', error.message),
    });
  };

  return (
    <Table caption="Platform users">
      <thead>
        <tr>
          <Th>Name</Th>
          <Th>Email</Th>
          <Th>Role</Th>
          <Th>Status</Th>
          <Th align="end">
            <span className="sr-only">Actions</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {users.map((user) => {
          const isLastSuperadmin =
            isSuperadmin(user) && !user.banned && activeSuperadminCount === 1;
          const lastSuperadminHint = isLastSuperadmin
            ? 'The last active superadmin cannot be demoted or banned'
            : undefined;

          return (
            <tr key={user.id}>
              <Td>{user.name}</Td>
              <Td variant="mono">{user.email}</Td>
              <Td>
                <Select
                  aria-label={`Role of ${user.email}`}
                  items={ROLE_ITEMS}
                  value={(user.role ?? 'user') as PlatformRole}
                  onValueChange={(role) => handleRoleChange(user, role)}
                  disabled={isBusy || isLastSuperadmin}
                />
              </Td>
              <Td>
                <Chip tone={user.banned ? 'danger' : 'neutral'}>
                  {user.banned ? 'Banned' : 'Active'}
                </Chip>
              </Td>
              <Td variant="end">
                <div className="flex justify-end gap-1">
                  <Button
                    variant="quiet"
                    size="sm"
                    aria-label={`Set password of ${user.email}`}
                    disabled={isBusy}
                    onClick={() => onSetPassword(user)}
                  >
                    Set password
                  </Button>
                  <Button
                    variant="quiet"
                    size="sm"
                    aria-label={`Revoke sessions of ${user.email}`}
                    disabled={isBusy}
                    onClick={() => handleRevoke(user)}
                  >
                    Revoke sessions
                  </Button>
                  {user.banned ? (
                    <Button
                      variant="quiet"
                      size="sm"
                      aria-label={`Unban ${user.email}`}
                      disabled={isBusy}
                      onClick={() => handleUnban(user)}
                    >
                      Unban
                    </Button>
                  ) : (
                    <Button
                      variant="danger"
                      size="sm"
                      aria-label={`Ban ${user.email}`}
                      title={lastSuperadminHint}
                      disabled={isBusy || isLastSuperadmin}
                      onClick={() => handleBan(user)}
                    >
                      Ban
                    </Button>
                  )}
                </div>
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
