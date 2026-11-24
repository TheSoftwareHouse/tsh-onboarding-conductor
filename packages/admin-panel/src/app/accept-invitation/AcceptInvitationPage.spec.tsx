import '@testing-library/jest-dom/vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acceptInvitation, signUpInvitee } from '@/api/organization/organization';
import { createQueryClient } from '@/services/query-client/create-query-client';
import { AcceptInvitationPage } from './AcceptInvitationPage';

vi.mock('@/api/organization/organization', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/organization/organization')>()),
  acceptInvitation: vi.fn(),
  signUpInvitee: vi.fn(),
}));

const { mockedUseSession, mockedSuccessToast, mockedErrorToast, mockedAssign } = vi.hoisted(() => ({
  mockedUseSession: vi.fn(),
  mockedSuccessToast: vi.fn(),
  mockedErrorToast: vi.fn(),
  mockedAssign: vi.fn(),
}));

vi.mock('@/services/auth/auth-client', () => ({
  authClient: { useSession: mockedUseSession },
}));

vi.mock('@/components/ui/Toast/toast-manager', () => ({
  showSuccessToast: mockedSuccessToast,
  showErrorToast: mockedErrorToast,
}));

function renderPage() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={['/accept-invitation/inv-1']}>
        <Routes>
          <Route path="/accept-invitation/:invitationId" element={<AcceptInvitationPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function fillSignUp(): Promise<void> {
  await userEvent.type(screen.getByLabelText(/^Name/), 'Ann Kowalska');
  await userEvent.type(screen.getByLabelText(/^Email/), 'ann@tsh.io');
  await userEvent.type(screen.getByLabelText(/^Password/), 'password-1');
  await userEvent.click(screen.getByRole('button', { name: 'Create account and join' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('location', { ...window.location, assign: mockedAssign });
  mockedUseSession.mockReturnValue({ data: null, isPending: false });
  vi.mocked(acceptInvitation).mockResolvedValue({} as never);
  vi.mocked(signUpInvitee).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AcceptInvitationPage', () => {
  it('waits for the session before choosing a flow', () => {
    mockedUseSession.mockReturnValue({ data: null, isPending: true });

    renderPage();

    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
  });

  it('lets a signed-in user accept directly and continues into the panel', async () => {
    mockedUseSession.mockReturnValue({ data: { user: { email: 'ann@tsh.io' } }, isPending: false });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));

    await waitFor(() => expect(acceptInvitation).toHaveBeenCalledWith('inv-1'));
    expect(signUpInvitee).not.toHaveBeenCalled();
    await waitFor(() => expect(mockedAssign).toHaveBeenCalledWith('/organization'));
    expect(mockedSuccessToast).toHaveBeenCalledWith('Invitation accepted');
  });

  it('reports a refused acceptance and stays on the page', async () => {
    mockedUseSession.mockReturnValue({ data: { user: { email: 'ann@tsh.io' } }, isPending: false });
    vi.mocked(acceptInvitation).mockRejectedValue(new Error('Expired'));
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));

    await waitFor(() =>
      expect(mockedErrorToast).toHaveBeenCalledWith('Invitation not accepted', 'Expired'),
    );
    expect(mockedAssign).not.toHaveBeenCalled();
  });

  it('signs a new user up, accepts, then continues into the panel', async () => {
    renderPage();

    await fillSignUp();

    await waitFor(() =>
      expect(signUpInvitee).toHaveBeenCalledWith({
        name: 'Ann Kowalska',
        email: 'ann@tsh.io',
        password: 'password-1',
        // The id from the mailed link: the engine refuses a sign-up that does not name it.
        invitationId: 'inv-1',
      }),
    );
    await waitFor(() => expect(acceptInvitation).toHaveBeenCalledWith('inv-1'));
    await waitFor(() => expect(mockedAssign).toHaveBeenCalledWith('/organization'));
  });

  it('does not accept when the sign-up is refused', async () => {
    vi.mocked(signUpInvitee).mockRejectedValue(new Error('Sign-up is by invitation only.'));
    renderPage();

    await fillSignUp();

    await waitFor(() =>
      expect(mockedErrorToast).toHaveBeenCalledWith(
        'Invitation not accepted',
        'Sign-up is by invitation only.',
      ),
    );
    expect(acceptInvitation).not.toHaveBeenCalled();
    expect(mockedAssign).not.toHaveBeenCalled();
  });

  it('rejects a short password without calling the engine', async () => {
    renderPage();

    await userEvent.type(screen.getByLabelText(/^Name/), 'Ann');
    await userEvent.type(screen.getByLabelText(/^Email/), 'ann@tsh.io');
    await userEvent.type(screen.getByLabelText(/^Password/), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create account and join' }));

    expect(await screen.findByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(signUpInvitee).not.toHaveBeenCalled();
  });
});
