import '@testing-library/jest-dom/vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchActiveOrganization } from '@/api/organization/organization';
import { createQueryClient } from '@/services/query-client/create-query-client';
import { OrganizationPage } from './OrganizationPage';

vi.mock('@/api/organization/organization', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/organization/organization')>()),
  fetchActiveOrganization: vi.fn(),
}));

vi.mock('./components/MembersTable/MembersTable', () => ({
  MembersTable: ({ members }: { members: unknown[] }) => <p>members: {members.length}</p>,
}));
vi.mock('./components/InvitationsTable/InvitationsTable', () => ({
  InvitationsTable: ({ invitations }: { invitations: unknown[] }) => (
    <p>invitations: {invitations.length}</p>
  ),
}));
vi.mock('./components/InviteForm/InviteForm', () => ({
  InviteForm: () => <p>invite form</p>,
}));

function renderPage() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <OrganizationPage eyebrow="Admin" title="Organization" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('OrganizationPage', () => {
  it('shows the organization with its members and only its pending invitations', async () => {
    vi.mocked(fetchActiveOrganization).mockResolvedValue({
      id: 'org-1',
      name: 'Acme',
      members: [{ id: 'm-1' }, { id: 'm-2' }],
      invitations: [
        { id: 'i-1', status: 'pending' },
        { id: 'i-2', status: 'accepted' },
        { id: 'i-3', status: 'canceled' },
      ],
    } as never);

    renderPage();

    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('members: 2')).toBeInTheDocument();
    expect(screen.getByText('invitations: 1')).toBeInTheDocument();
    expect(screen.getByText('invite form')).toBeInTheDocument();
  });

  it('says so when the session has no active organization', async () => {
    vi.mocked(fetchActiveOrganization).mockResolvedValue(null as never);

    renderPage();

    expect(await screen.findByText(/No active organization/)).toBeInTheDocument();
    expect(screen.queryByText('invite form')).not.toBeInTheDocument();
  });

  it('reports a failed load', async () => {
    vi.mocked(fetchActiveOrganization).mockRejectedValue(new Error('Boom'));

    renderPage();

    expect(await screen.findByText('Unable to load the organization: Boom')).toBeInTheDocument();
  });
});
