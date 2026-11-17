import '@testing-library/jest-dom/vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPlatformUsers, fetchSuperadmins } from '@/api/platform/platform';
import { createQueryClient } from '@/services/query-client/create-query-client';
import { UsersPage } from './UsersPage';

vi.mock('@/api/platform/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/platform/platform')>()),
  fetchPlatformUsers: vi.fn(),
  fetchSuperadmins: vi.fn(),
}));

vi.mock('./components/UsersTable/UsersTable', () => ({
  UsersTable: ({
    users,
    activeSuperadminCount,
    onSetPassword,
  }: {
    users: { id: string; email: string }[];
    activeSuperadminCount: number | undefined;
    onSetPassword: (user: { id: string; email: string }) => void;
  }) => (
    <div>
      <p>users: {users.length}</p>
      <p>active superadmins: {String(activeSuperadminCount)}</p>
      <button type="button" onClick={() => onSetPassword(users[0])}>
        password
      </button>
    </div>
  ),
}));
vi.mock('./components/SetPasswordForm/SetPasswordForm', () => ({
  SetPasswordForm: ({ email }: { email: string }) => <p>password form: {email}</p>,
}));

function renderPage() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <UsersPage eyebrow="Admin" title="Users" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchPlatformUsers).mockResolvedValue({
    users: [{ id: 'u-1', email: 'ann@tsh.io' }],
    total: 45,
  } as never);
  vi.mocked(fetchSuperadmins).mockResolvedValue([
    { id: 'u-1', banned: false },
    { id: 'u-9', banned: true },
  ] as never);
});

afterEach(() => {
  cleanup();
});

describe('UsersPage', () => {
  it('lists the users and counts only the non-banned superadmins', async () => {
    renderPage();

    expect(await screen.findByText('users: 1')).toBeInTheDocument();
    expect(await screen.findByText('active superadmins: 1')).toBeInTheDocument();
    expect(fetchPlatformUsers).toHaveBeenCalledWith({ search: '', page: 1, pageSize: 20 });
  });

  it('searches by email from the first page', async () => {
    renderPage();
    await screen.findByText('users: 1');

    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Search users by email' }),
      'ann{Enter}',
    );

    await vi.waitFor(() =>
      expect(fetchPlatformUsers).toHaveBeenLastCalledWith({ search: 'ann', page: 1, pageSize: 20 }),
    );
  });

  it('pages through the users', async () => {
    renderPage();
    await screen.findByText('users: 1');

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    await vi.waitFor(() =>
      expect(fetchPlatformUsers).toHaveBeenLastCalledWith({ search: '', page: 2, pageSize: 20 }),
    );
  });

  it('opens the password form for the chosen user', async () => {
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'password' }));

    expect(screen.getByText('password form: ann@tsh.io')).toBeInTheDocument();
  });

  it('reports a failed load', async () => {
    vi.mocked(fetchPlatformUsers).mockRejectedValue(new Error('Boom'));

    renderPage();

    expect(await screen.findByText('Unable to load the users: Boom')).toBeInTheDocument();
  });
});
