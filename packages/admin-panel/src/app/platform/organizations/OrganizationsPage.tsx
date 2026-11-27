import type { ReactElement, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { platformQueries } from '@/api/platform/platform-queries';
import type { AdminPageProps } from '@/lib/admin-page';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import { Loader } from '@/components/ui/Loader/Loader';
import { LoadFailure } from '@/components/ui/LoadFailure/LoadFailure';
import { PageHeader } from '@/components/ui/PageHeader/PageHeader';
import { TableResults } from '@/components/ui/TableResults/TableResults';
import { OrganizationsTable } from './components/OrganizationsTable/OrganizationsTable';

/** The platform's organizations for a superadmin. */
export function OrganizationsPage({ eyebrow, title }: AdminPageProps): ReactElement {
  const { data, isPending, isError, error, refetch } = useQuery(platformQueries.organizations());
  const organizations = data ?? [];

  let state: ReactNode;
  let statusMessage: string | null = null;

  if (isPending) {
    state = <Loader label="Loading organizations…" />;
  } else if (isError) {
    state = <LoadFailure error={error} subject="organizations" onRetry={() => refetch()} />;
  } else if (organizations.length === 0) {
    state = (
      <EmptyState
        title="No organizations yet"
        body="You are not a member of any organization yet. This list shows only the organizations you belong to."
      />
    );
  } else {
    statusMessage = `${organizations.length} organization${organizations.length === 1 ? '' : 's'}`;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader eyebrow={eyebrow} title={title} />
      <TableResults
        statusMessage={statusMessage}
        regionLabel="Organizations results"
        paginationLabel="Organizations pages"
        state={state}
        pagination={null}
        paginationDisabled={false}
        onPageChange={() => undefined}
      >
        <OrganizationsTable organizations={organizations} />
      </TableResults>
    </div>
  );
}
