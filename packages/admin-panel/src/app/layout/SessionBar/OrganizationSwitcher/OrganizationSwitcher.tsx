import type { ReactElement } from 'react';
import { Select } from '@/components/ui/Select/Select';
import { showErrorToast } from '@/components/ui/Toast/toast-manager';
import { authClient } from '@/services/auth/auth-client';

const MIN_ORGANIZATIONS_TO_SWITCH = 2;

/** Picks the organization admin requests are authorised against. Hidden unless there is a choice. */
export function OrganizationSwitcher(): ReactElement | null {
  const { data: session } = authClient.useSession();
  const { data: organizations } = authClient.useListOrganizations();

  if (!organizations || organizations.length < MIN_ORGANIZATIONS_TO_SWITCH) {
    return null;
  }

  const handleChange = async (organizationId: string): Promise<void> => {
    const { error } = await authClient.organization.setActive({ organizationId });
    if (error) {
      showErrorToast('Organization not switched', error.message ?? 'Try again.');
    }
    // Every admin read is scoped to the active organization; `SessionCacheGuard` resets the cache
    // once the session reports the new one.
  };

  return (
    <Select
      aria-label="Organization"
      items={organizations.map((organization) => ({
        value: organization.id,
        label: organization.name,
      }))}
      value={session?.session.activeOrganizationId ?? null}
      onValueChange={(organizationId) => void handleChange(organizationId)}
      placeholder="Choose organization"
    />
  );
}
