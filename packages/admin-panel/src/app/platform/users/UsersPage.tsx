import type { ReactElement } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PlatformUser } from '@/api/platform/platform';
import { platformQueries } from '@/api/platform/platform-queries';
import type { AdminPageProps } from '@/lib/admin-page';
import { DEFAULT_PAGE, PAGE_SIZES } from '@/lib/pagination';
import { PageHeader } from '@/components/ui/PageHeader/PageHeader';
import { Pagination } from '@/components/ui/Pagination/Pagination';
import { SearchInput } from '@/components/ui/SearchInput/SearchInput';
import { StatusRegion } from '@/components/ui/StatusRegion/StatusRegion';
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
  const total = users.data?.total ?? 0;

  const commitSearch = (): void => {
    setSearch(draftSearch.trim());
    setPage(DEFAULT_PAGE);
  };

  let statusMessage = '';
  if (users.isLoading) {
    statusMessage = 'Loading users…';
  } else if (users.error) {
    statusMessage = `Unable to load the users: ${users.error.message}`;
  }

  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title}>
        <SearchInput
          label="Search users by email"
          placeholder="Search by email"
          value={draftSearch}
          onChange={setDraftSearch}
          onSubmit={commitSearch}
        />
        <StatusRegion>{statusMessage}</StatusRegion>
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-8">
        {passwordTarget ? (
          <SetPasswordForm
            key={passwordTarget.id}
            userId={passwordTarget.id}
            email={passwordTarget.email}
            onDone={() => setPasswordTarget(null)}
          />
        ) : null}
        {users.data ? (
          <>
            <UsersTable
              users={users.data.users}
              activeSuperadminCount={activeSuperadminCount}
              onSetPassword={setPasswordTarget}
            />
            <Pagination
              label="Users pages"
              pagination={{
                page,
                limit: PAGE_SIZE,
                total,
                totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
              }}
              disabled={users.isFetching}
              onPageChange={setPage}
            />
          </>
        ) : null}
      </div>
    </>
  );
}
