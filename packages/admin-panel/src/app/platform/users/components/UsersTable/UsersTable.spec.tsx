import '@testing-library/jest-dom/vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  banUser,
  revokeUserSessions,
  setUserRole,
  unbanUser,
  type PlatformUser,
} from '@/api/platform/platform';
import { createQueryClient } from '@/services/query-client/create-query-client';
import { UsersTable } from './UsersTable';

vi.mock('@/api/platform/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/platform/platform')>()),
  setUserRole: vi.fn(),
  banUser: vi.fn(),
  unbanUser: vi.fn(),
  revokeUserSessions: vi.fn(),
}));

const { mockedSuccessToast, mockedErrorToast } = vi.hoisted(() => ({
  mockedSuccessToast: vi.fn(),
  mockedErrorToast: vi.fn(),
}));

vi.mock('@/components/ui/Toast/toast-manager', () => ({
  showSuccessToast: mockedSuccessToast,
  showErrorToast: mockedErrorToast,
}));

// Base UI's popup does not open reliably in jsdom; a native select exercises the same props.
vi.mock('@/components/ui/Select/Select', () => ({
  Select: (props: {
    items: { value: string; label: string }[];
    value: string | null;
    onValueChange: (value: string) => void;
    disabled?: boolean;
    'aria-label': string;
  }) => (
    <select
      aria-label={props['aria-label']}
      value={props.value ?? ''}
      disabled={props.disabled}
      onChange={(event) => props.onValueChange(event.target.value)}
    >
      {props.items.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  ),
}));

const USERS = [
  { id: 'u-1', name: 'Ann', email: 'ann@tsh.io', role: 'superadmin', banned: false },
  { id: 'u-2', name: 'Bob', email: 'bob@tsh.io', role: 'user', banned: false },
  { id: 'u-3', name: 'Cy', email: 'cy@tsh.io', role: 'user', banned: true },
] as unknown as PlatformUser[];

function renderTable(activeSuperadminCount: number | undefined = 2, onSetPassword = vi.fn()) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <UsersTable
        users={USERS}
        activeSuperadminCount={activeSuperadminCount}
        onSetPassword={onSetPassword}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setUserRole).mockResolvedValue({} as never);
  vi.mocked(banUser).mockResolvedValue({} as never);
  vi.mocked(unbanUser).mockResolvedValue({} as never);
  vi.mocked(revokeUserSessions).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
});

describe('UsersTable', () => {
  it('lists each user with role and status', () => {
    renderTable();

    expect(screen.getByRole('combobox', { name: 'Role of ann@tsh.io' })).toHaveValue('superadmin');
    expect(screen.getByText('Banned')).toBeInTheDocument();
    expect(screen.getAllByText('Active')).toHaveLength(2);
  });

  it('changes a platform role and reports it', async () => {
    renderTable();

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Role of bob@tsh.io' }),
      'superadmin',
    );

    await waitFor(() => expect(setUserRole).toHaveBeenCalledWith('u-2', 'superadmin'));
    await waitFor(() =>
      expect(mockedSuccessToast).toHaveBeenCalledWith('bob@tsh.io is now superadmin'),
    );
  });

  it('shows the engine refusal of a role change', async () => {
    vi.mocked(setUserRole).mockRejectedValue(
      new Error('At least one active superadmin must remain.'),
    );
    renderTable();

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Role of ann@tsh.io' }),
      'user',
    );

    await waitFor(() =>
      expect(mockedErrorToast).toHaveBeenCalledWith(
        'Role not changed',
        'At least one active superadmin must remain.',
      ),
    );
  });

  it('bans, unbans and revokes sessions', async () => {
    renderTable();

    await userEvent.click(screen.getByRole('button', { name: 'Ban bob@tsh.io' }));
    await userEvent.click(screen.getByRole('button', { name: 'Unban cy@tsh.io' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revoke sessions of bob@tsh.io' }));

    await waitFor(() => expect(banUser).toHaveBeenCalledWith('u-2'));
    await waitFor(() => expect(unbanUser).toHaveBeenCalledWith('u-3'));
    await waitFor(() => expect(revokeUserSessions).toHaveBeenCalledWith('u-2'));
    expect(mockedSuccessToast).toHaveBeenCalledWith('bob@tsh.io banned');
  });

  it('shows the engine refusal of a ban', async () => {
    vi.mocked(banUser).mockRejectedValue(new Error('At least one active superadmin must remain.'));
    renderTable();

    await userEvent.click(screen.getByRole('button', { name: 'Ban bob@tsh.io' }));

    await waitFor(() =>
      expect(mockedErrorToast).toHaveBeenCalledWith(
        'User not banned',
        'At least one active superadmin must remain.',
      ),
    );
  });

  it('offers no demote or ban on the last active superadmin', () => {
    renderTable(1);

    expect(screen.getByRole('combobox', { name: 'Role of ann@tsh.io' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ban ann@tsh.io' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ban bob@tsh.io' })).toBeEnabled();
  });

  it('holds nothing back while the superadmin count is unknown', () => {
    renderTable(undefined);

    expect(screen.getByRole('button', { name: 'Ban ann@tsh.io' })).toBeEnabled();
  });

  it('hands the user to the password form', async () => {
    const onSetPassword = vi.fn();
    renderTable(2, onSetPassword);

    await userEvent.click(screen.getByRole('button', { name: 'Set password of bob@tsh.io' }));

    expect(onSetPassword).toHaveBeenCalledWith(USERS[1]);
  });
});
