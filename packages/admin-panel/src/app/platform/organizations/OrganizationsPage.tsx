import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { platformQueries } from '@/api/platform/platform-queries';
import type { AdminPageProps } from '@/lib/admin-page';
import { PageHeader } from '@/components/ui/PageHeader/PageHeader';
import { StatusRegion } from '@/components/ui/StatusRegion/StatusRegion';
import { Typography } from '@/components/ui/Typography/Typography';
import { CreateOrganizationForm } from './components/CreateOrganizationForm/CreateOrganizationForm';
import { OrganizationsTable } from './components/OrganizationsTable/OrganizationsTable';

/** The platform's organizations for a superadmin, and the form that creates a new one. */
export function OrganizationsPage({ eyebrow, title }: AdminPageProps): ReactElement {
  const { data: organizations, isLoading, error } = useQuery(platformQueries.organizations());

  let statusMessage = '';
  if (isLoading) {
    statusMessage = 'Loading organizations…';
  } else if (error) {
    statusMessage = `Unable to load the organizations: ${error.message}`;
  }

  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title}>
        <StatusRegion>{statusMessage}</StatusRegion>
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto p-8">
        <section
          aria-labelledby="platform-organizations-create-heading"
          className="flex flex-col gap-3"
        >
          <Typography
            variant="caps-tiny"
            as="h2"
            id="platform-organizations-create-heading"
            className="text-fg-3"
          >
            Create
          </Typography>
          <CreateOrganizationForm />
        </section>
        {organizations ? <OrganizationsTable organizations={organizations} /> : null}
      </div>
    </>
  );
}
