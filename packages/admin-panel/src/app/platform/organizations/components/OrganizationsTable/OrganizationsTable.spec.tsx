import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformOrganization } from '@/api/platform/platform';
import { OrganizationsTable } from './OrganizationsTable';

afterEach(() => {
  cleanup();
});

describe('OrganizationsTable', () => {
  it('lists each organization with its slug', () => {
    render(
      <OrganizationsTable
        organizations={[{ id: 'o-1', name: 'Acme', slug: 'acme' }] as PlatformOrganization[]}
      />,
    );

    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('acme')).toBeInTheDocument();
  });
});
