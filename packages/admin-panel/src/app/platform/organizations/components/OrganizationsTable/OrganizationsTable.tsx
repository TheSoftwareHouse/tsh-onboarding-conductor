import type { ReactElement } from 'react';
import type { PlatformOrganization } from '@/api/platform/platform';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import { Table, Td, Th } from '@/components/ui/DataTable/DataTable';

export interface OrganizationsTableProps {
  organizations: readonly PlatformOrganization[];
}

/** The organizations the superadmin belongs to. */
export function OrganizationsTable({ organizations }: OrganizationsTableProps): ReactElement {
  return (
    <>
      <Table caption="Organizations">
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Slug</Th>
          </tr>
        </thead>
        <tbody>
          {organizations.map((organization) => (
            <tr key={organization.id}>
              <Td>{organization.name}</Td>
              <Td variant="mono">{organization.slug}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {organizations.length === 0 && <EmptyState layout="section" title="No organizations" />}
    </>
  );
}
