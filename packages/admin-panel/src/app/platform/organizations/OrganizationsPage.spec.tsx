import '@testing-library/jest-dom/vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPlatformOrganizations } from '@/api/platform/platform';
import { createQueryClient } from '@/services/query-client/create-query-client';
import { OrganizationsPage } from './OrganizationsPage';

vi.mock('@/api/platform/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/platform/platform')>()),
  fetchPlatformOrganizations: vi.fn(),
}));

vi.mock('./components/OrganizationsTable/OrganizationsTable', () => ({
  OrganizationsTable: ({ organizations }: { organizations: unknown[] }) => (
    <p>organizations: {organizations.length}</p>
  ),
}));
vi.mock('./components/CreateOrganizationForm/CreateOrganizationForm', () => ({
  CreateOrganizationForm: () => <p>create form</p>,
}));

function renderPage() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <OrganizationsPage eyebrow="Admin" title="Organizations" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('OrganizationsPage', () => {
  it('shows the create form and the organizations', async () => {
    vi.mocked(fetchPlatformOrganizations).mockResolvedValue([
      { id: 'o-1' },
      { id: 'o-2' },
    ] as never);

    renderPage();

    expect(await screen.findByText('organizations: 2')).toBeInTheDocument();
    expect(screen.getByText('create form')).toBeInTheDocument();
  });

  it('reports a failed load', async () => {
    vi.mocked(fetchPlatformOrganizations).mockRejectedValue(new Error('Boom'));

    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Unable to load organizations');
    expect(alert).toHaveTextContent('Boom');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByText('create form')).toBeInTheDocument();
  });

  it('keeps the table and says so when there are no organizations', async () => {
    vi.mocked(fetchPlatformOrganizations).mockResolvedValue([] as never);

    renderPage();

    expect(await screen.findByText('No organizations yet')).toBeInTheDocument();
    expect(screen.getByText('organizations: 0')).toBeInTheDocument();
  });
});
