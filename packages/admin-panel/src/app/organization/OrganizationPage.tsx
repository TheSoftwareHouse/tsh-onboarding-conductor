import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { organizationQueries } from '@/api/organization/organization-queries';
import type { AdminPageProps } from '@/lib/admin-page';
import { PageHeader } from '@/components/ui/PageHeader/PageHeader';
import { StatusRegion } from '@/components/ui/StatusRegion/StatusRegion';
import { Typography } from '@/components/ui/Typography/Typography';
import { InvitationsTable } from './components/InvitationsTable/InvitationsTable';
import { InviteForm } from './components/InviteForm/InviteForm';
import { MembersTable } from './components/MembersTable/MembersTable';

const PENDING_INVITATION_STATUS = 'pending';

/** Members and invitations of the organization the session is acting in, with invite, role change, removal and cancel. */
export function OrganizationPage({ eyebrow, title }: AdminPageProps): ReactElement {
  const { data: organization, isLoading, error } = useQuery(organizationQueries.active());

  let statusMessage = '';
  if (isLoading) {
    statusMessage = 'Loading organization…';
  } else if (error) {
    statusMessage = `Unable to load the organization: ${error.message}`;
  } else if (!organization) {
    statusMessage = 'No active organization. Ask a platform administrator to add you to one.';
  }

  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title}>
        <StatusRegion>{statusMessage}</StatusRegion>
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto p-8">
        {organization ? (
          <>
            <Typography variant="body-md" className="text-fg-3">
              {organization.name}
            </Typography>
            <section aria-labelledby="organization-invite-heading" className="flex flex-col gap-3">
              <Typography
                variant="caps-tiny"
                as="h2"
                id="organization-invite-heading"
                className="text-fg-3"
              >
                Invite
              </Typography>
              <InviteForm />
            </section>
            <section aria-labelledby="organization-members-heading" className="flex flex-col gap-3">
              <Typography
                variant="caps-tiny"
                as="h2"
                id="organization-members-heading"
                className="text-fg-3"
              >
                Members
              </Typography>
              <MembersTable members={organization.members} />
            </section>
            <section
              aria-labelledby="organization-invitations-heading"
              className="flex flex-col gap-3"
            >
              <Typography
                variant="caps-tiny"
                as="h2"
                id="organization-invitations-heading"
                className="text-fg-3"
              >
                Pending invitations
              </Typography>
              <InvitationsTable
                invitations={organization.invitations.filter(
                  (invitation) => invitation.status === PENDING_INVITATION_STATUS,
                )}
              />
            </section>
          </>
        ) : null}
      </div>
    </>
  );
}
