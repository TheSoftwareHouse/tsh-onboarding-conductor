import '@testing-library/jest-dom/vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelInvitation, type OrganizationInvitation } from '@/api/organization/organization';
import { createQueryClient } from '@/services/query-client/create-query-client';
import { InvitationsTable } from './InvitationsTable';

vi.mock('@/api/organization/organization', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/organization/organization')>()),
  cancelInvitation: vi.fn(),
}));

const { mockedSuccessToast, mockedErrorToast } = vi.hoisted(() => ({
  mockedSuccessToast: vi.fn(),
  mockedErrorToast: vi.fn(),
}));

vi.mock('@/components/ui/Toast/toast-manager', () => ({
  showSuccessToast: mockedSuccessToast,
  showErrorToast: mockedErrorToast,
}));

const INVITATIONS = [
  { id: 'inv-1', email: 'new@tsh.io', role: 'member', expiresAt: '2030-01-01T00:00:00.000Z' },
] as unknown as OrganizationInvitation[];

function renderTable(invitations: readonly OrganizationInvitation[] = INVITATIONS) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <InvitationsTable invitations={invitations} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(cancelInvitation).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
});

describe('InvitationsTable', () => {
  it('lists each pending invitation', () => {
    renderTable();

    expect(screen.getByText('new@tsh.io')).toBeInTheDocument();
    expect(screen.getByText('member')).toBeInTheDocument();
  });

  it('cancels an invitation and reports it', async () => {
    renderTable();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel invitation for new@tsh.io' }));

    await waitFor(() => expect(cancelInvitation).toHaveBeenCalledWith('inv-1'));
    await waitFor(() =>
      expect(mockedSuccessToast).toHaveBeenCalledWith('Invitation for new@tsh.io cancelled'),
    );
  });

  it('reports a refused cancellation', async () => {
    vi.mocked(cancelInvitation).mockRejectedValue(new Error('Not allowed'));
    renderTable();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel invitation for new@tsh.io' }));

    await waitFor(() =>
      expect(mockedErrorToast).toHaveBeenCalledWith('Invitation not cancelled', 'Not allowed'),
    );
  });
});
