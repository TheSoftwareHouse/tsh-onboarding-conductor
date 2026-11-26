import '@testing-library/jest-dom/vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setUserPassword } from '@/api/platform/platform';
import { createQueryClient } from '@/services/query-client/create-query-client';
import { SetPasswordForm } from './SetPasswordForm';

vi.mock('@/api/platform/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/platform/platform')>()),
  setUserPassword: vi.fn(),
}));

const { mockedSuccessToast, mockedErrorToast } = vi.hoisted(() => ({
  mockedSuccessToast: vi.fn(),
  mockedErrorToast: vi.fn(),
}));

vi.mock('@/components/ui/Toast/toast-manager', () => ({
  showSuccessToast: mockedSuccessToast,
  showErrorToast: mockedErrorToast,
}));

const onDone = vi.fn();

function renderForm() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <SetPasswordForm userId="u-2" email="bob@tsh.io" onDone={onDone} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setUserPassword).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
});

describe('SetPasswordForm', () => {
  it('sets the password, reports it and closes', async () => {
    renderForm();

    await userEvent.type(screen.getByLabelText(/^Temporary password/), 'temporary-1');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));

    await waitFor(() => expect(setUserPassword).toHaveBeenCalledWith('u-2', 'temporary-1'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mockedSuccessToast).toHaveBeenCalledWith('Password of bob@tsh.io set');
  });

  it('rejects a short password without calling the engine', async () => {
    renderForm();

    await userEvent.type(screen.getByLabelText(/^Temporary password/), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(setUserPassword).not.toHaveBeenCalled();
  });

  it('reports a refusal and stays open', async () => {
    vi.mocked(setUserPassword).mockRejectedValue(new Error('Nope'));
    renderForm();

    await userEvent.type(screen.getByLabelText(/^Temporary password/), 'temporary-1');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));

    await waitFor(() => expect(mockedErrorToast).toHaveBeenCalledWith('Password not set', 'Nope'));
    expect(onDone).not.toHaveBeenCalled();
  });

  it('closes on cancel', async () => {
    renderForm();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onDone).toHaveBeenCalled();
  });
});
