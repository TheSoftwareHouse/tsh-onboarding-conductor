import '@testing-library/jest-dom/vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inviteMember } from '@/api/organization/organization';
import { createQueryClient } from '@/services/query-client/create-query-client';
import { InviteForm } from './InviteForm';

vi.mock('@/api/organization/organization', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/organization/organization')>()),
  inviteMember: vi.fn(),
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
    'aria-label': string;
  }) => (
    <select
      aria-label={props['aria-label']}
      value={props.value ?? ''}
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

function renderForm() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <InviteForm />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(inviteMember).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
});

describe('InviteForm', () => {
  it('invites the address with the chosen role, reports it and clears the form', async () => {
    renderForm();

    await userEvent.type(screen.getByLabelText(/^Email/), 'new@tsh.io');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role' }), 'admin');
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));

    await waitFor(() => expect(inviteMember).toHaveBeenCalledWith('new@tsh.io', 'admin'));
    await waitFor(() =>
      expect(mockedSuccessToast).toHaveBeenCalledWith('Invitation sent to new@tsh.io'),
    );
    await waitFor(() => expect(screen.getByLabelText(/^Email/)).toHaveValue(''));
  });

  it('defaults the role to member', async () => {
    renderForm();

    await userEvent.type(screen.getByLabelText(/^Email/), 'new@tsh.io');
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));

    await waitFor(() => expect(inviteMember).toHaveBeenCalledWith('new@tsh.io', 'member'));
  });

  it('rejects an invalid address without calling the engine', async () => {
    renderForm();

    await userEvent.type(screen.getByLabelText(/^Email/), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));

    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(inviteMember).not.toHaveBeenCalled();
  });

  it('reports a refused invitation and keeps the input', async () => {
    vi.mocked(inviteMember).mockRejectedValue(new Error('Already a member'));
    renderForm();

    await userEvent.type(screen.getByLabelText(/^Email/), 'new@tsh.io');
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));

    await waitFor(() =>
      expect(mockedErrorToast).toHaveBeenCalledWith('Invitation not sent', 'Already a member'),
    );
    expect(screen.getByLabelText(/^Email/)).toHaveValue('new@tsh.io');
  });
});
