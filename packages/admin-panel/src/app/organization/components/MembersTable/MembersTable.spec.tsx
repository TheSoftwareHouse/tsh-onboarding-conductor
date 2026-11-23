import '@testing-library/jest-dom/vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  removeMember,
  updateMemberRole,
  type OrganizationMember,
} from '@/api/organization/organization';
import { createQueryClient } from '@/services/query-client/create-query-client';
import { MembersTable } from './MembersTable';

vi.mock('@/api/organization/organization', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/organization/organization')>()),
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
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

const MEMBERS = [
  { id: 'm-1', role: 'admin', user: { name: 'Ann', email: 'ann@tsh.io' } },
  { id: 'm-2', role: 'member', user: { name: 'Bob', email: 'bob@tsh.io' } },
] as unknown as OrganizationMember[];

function renderTable(members: readonly OrganizationMember[] = MEMBERS) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MembersTable members={members} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateMemberRole).mockResolvedValue({} as never);
  vi.mocked(removeMember).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
});

describe('MembersTable', () => {
  it('lists each member with the current role selected', () => {
    renderTable();

    expect(screen.getByText('bob@tsh.io')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Role of ann@tsh.io' })).toHaveValue('admin');
  });

  it('shows an empty message without members', () => {
    renderTable([]);

    expect(screen.getByText('No members')).toBeInTheDocument();
  });

  it('changes a role and reports it', async () => {
    renderTable();

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Role of bob@tsh.io' }),
      'admin',
    );

    await waitFor(() => expect(updateMemberRole).toHaveBeenCalledWith('m-2', 'admin'));
    await waitFor(() => expect(mockedSuccessToast).toHaveBeenCalledWith('bob@tsh.io is now admin'));
  });

  it('reports a refused role change', async () => {
    vi.mocked(updateMemberRole).mockRejectedValue(new Error('Not allowed'));
    renderTable();

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Role of bob@tsh.io' }),
      'owner',
    );

    await waitFor(() =>
      expect(mockedErrorToast).toHaveBeenCalledWith('Role not changed', 'Not allowed'),
    );
  });

  it('removes a member and reports it', async () => {
    renderTable();

    await userEvent.click(screen.getByRole('button', { name: 'Remove bob@tsh.io' }));

    await waitFor(() => expect(removeMember).toHaveBeenCalledWith('m-2'));
    await waitFor(() => expect(mockedSuccessToast).toHaveBeenCalledWith('bob@tsh.io removed'));
  });

  it('reports a refused removal', async () => {
    vi.mocked(removeMember).mockRejectedValue(new Error('Last owner'));
    renderTable();

    await userEvent.click(screen.getByRole('button', { name: 'Remove ann@tsh.io' }));

    await waitFor(() =>
      expect(mockedErrorToast).toHaveBeenCalledWith('Member not removed', 'Last owner'),
    );
  });
});
