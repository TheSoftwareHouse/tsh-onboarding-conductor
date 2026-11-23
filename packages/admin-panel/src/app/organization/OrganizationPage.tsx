import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { organizationQueries } from '@/api/organization/organization-queries';
import type { AdminPageProps } from '@/lib/admin-page';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import { Loader } from '@/components/ui/Loader/Loader';
import { LoadFailure } from '@/components/ui/LoadFailure/LoadFailure';
import { PageHeader } from '@/components/ui/PageHeader/PageHeader';
import { TableResults } from '@/components/ui/TableResults/TableResults';
import { Typography } from '@/components/ui/Typography/Typography';
import { InvitationsTable } from './components/InvitationsTable/InvitationsTable';
import { InviteForm } from './components/InviteForm/InviteForm';
import { MembersTable } from './components/MembersTable/MembersTable';

const PENDING_INVITATION_STATUS = 'pending';

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Members and invitations of the organization the session is acting in, with invite, role change, removal and cancel. */
export function OrganizationPage({ eyebrow, title }: AdminPageProps): ReactElement {
  const { data: organization, isPending, error, refetch } = useQuery(organizationQueries.active());

  let body: ReactElement;

  // Members and invitations arrive in one read, so the page loads and fails as one.
  if (isPending) {
    body = <Loader label="Loading the organization…" />;
  } else if (error) {
    body = <LoadFailure error={error} subject="the organization" onRetry={() => refetch()} />;
  } else if (!organization) {
    body = (
      <EmptyState
        title="No active organization"
        body="Ask a platform administrator to add you to one."
      />
    );
  } else {
    const pendingInvitations = organization.invitations.filter(
      (invitation) => invitation.status === PENDING_INVITATION_STATUS,
    );

    body = (
      <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto p-8">
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
          <TableResults
            statusMessage={countLabel(organization.members.length, 'member')}
            regionLabel="Organization members"
            paginationLabel="Members pages"
            state={
              organization.members.length === 0 ? (
                <EmptyState layout="section" title="No members" />
              ) : undefined
            }
            pagination={null}
            paginationDisabled={false}
            onPageChange={() => undefined}
          >
            <MembersTable members={organization.members} />
          </TableResults>
        </section>
        <section aria-labelledby="organization-invitations-heading" className="flex flex-col gap-3">
          <Typography
            variant="caps-tiny"
            as="h2"
            id="organization-invitations-heading"
            className="text-fg-3"
          >
            Pending invitations
          </Typography>
          <TableResults
            statusMessage={countLabel(pendingInvitations.length, 'pending invitation')}
            regionLabel="Pending invitations"
            paginationLabel="Invitations pages"
            state={
              pendingInvitations.length === 0 ? (
                <EmptyState
                  layout="section"
                  title="No pending invitations"
                  body="Invite someone above; the invitation waits here until they accept it."
                />
              ) : undefined
            }
            pagination={null}
            paginationDisabled={false}
            onPageChange={() => undefined}
          >
            <InvitationsTable invitations={pendingInvitations} />
          </TableResults>
        </section>
      </div>
    );
  }

  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title}>
        {organization ? (
          <Typography variant="body-md" className="text-fg-3">
            {organization.name}
          </Typography>
        ) : null}
      </PageHeader>
      {body}
    </>
  );
}
