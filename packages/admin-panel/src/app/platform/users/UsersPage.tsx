import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PlatformUser } from '@/api/platform/platform';
import { platformQueries } from '@/api/platform/platform-queries';
import type { AdminPageProps } from '@/lib/admin-page';
import { DEFAULT_PAGE, PAGE_SIZES, type PaginationWindow } from '@/lib/pagination';
import { Button } from '@/components/ui/Button/Button';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import { Loader } from '@/components/ui/Loader/Loader';
import { LoadFailure } from '@/components/ui/LoadFailure/LoadFailure';
import { PageHeader } from '@/components/ui/PageHeader/PageHeader';
import { SearchInput } from '@/components/ui/SearchInput/SearchInput';
import { TableResults } from '@/components/ui/TableResults/TableResults';
import { SetPasswordForm } from './components/SetPasswordForm/SetPasswordForm';
import { UsersTable } from './components/UsersTable/UsersTable';

const PAGE_SIZE = PAGE_SIZES[0];

/** Every user of the platform for a superadmin: search by email, page through, and manage each account. */
export function UsersPage({ eyebrow, title }: AdminPageProps): ReactElement {
  const [draftSearch, setDraftSearch] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(DEFAULT_PAGE);
  const [passwordTarget, setPasswordTarget] = useState<PlatformUser | null>(null);

  const users = useQuery(platformQueries.userList({ search, page, pageSize: PAGE_SIZE }));
  const superadmins = useQuery(platformQueries.superadmins());
  const activeSuperadminCount = superadmins.data?.filter((user) => !user.banned).length;

  const commitSearch = (): void => {
    setSearch(draftSearch.trim());
    setPage(DEFAULT_PAGE);
  };

  const resetSearch = (): void => {
    setDraftSearch('');
    setSearch('');
    setPage(DEFAULT_PAGE);
  };

  const records = users.data?.users ?? [];
  const total = users.data?.total ?? 0;

  let state: ReactNode;
  let statusMessage: string | null = null;
  let pagination: PaginationWindow | null = null;

  if (users.isPending) {
    state = <Loader label="Loading users…" />;
  } else if (users.isError) {
    state = <LoadFailure error={users.error} subject="users" onRetry={() => users.refetch()} />;
  } else if (records.length === 0) {
    if (total > 0) {
      state = <EmptyState kind="noMatch" title="No users on this page" />;
    } else if (search !== '') {
      state = (
        <EmptyState
          kind="noMatch"
          title={`No users match "${search}"`}
          body="Check the spelling, or reset the search."
          actions={
            <Button variant="primary" size="lg" onClick={resetSearch}>
              Reset search
            </Button>
          }
        />
      );
    } else {
      state = <EmptyState title="No users yet" />;
    }
  } else {
    const from = (page - 1) * PAGE_SIZE + 1;
    const to = Math.min(page * PAGE_SIZE, total);
    statusMessage = `Showing ${from}–${to} of ${total} users.`;
    pagination = { page, limit: PAGE_SIZE, total, totalPages: Math.ceil(total / PAGE_SIZE) };
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader eyebrow={eyebrow} title={title}>
        <SearchInput
          label="Search users by email"
          placeholder="Search by email"
          value={draftSearch}
          disabled={users.isPending}
          onChange={setDraftSearch}
          onSubmit={commitSearch}
        />
      </PageHeader>
      {passwordTarget ? (
        <div className="flex-none px-8 pt-6">
          <SetPasswordForm
            key={passwordTarget.id}
            userId={passwordTarget.id}
            email={passwordTarget.email}
            onDone={() => setPasswordTarget(null)}
          />
        </div>
      ) : null}
      <TableResults
        statusMessage={statusMessage}
        regionLabel="Users results"
        paginationLabel="Users pages"
        state={state}
        pagination={pagination}
        paginationDisabled={users.isFetching}
        onPageChange={setPage}
      >
        <UsersTable
          users={records}
          activeSuperadminCount={activeSuperadminCount}
          onSetPassword={setPasswordTarget}
        />
      </TableResults>
    </div>
  );
}
