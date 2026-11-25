import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResetPassword } from './ResetPassword';

const { mockedResetPassword, mockedToast } = vi.hoisted(() => ({
  mockedResetPassword: vi.fn(),
  mockedToast: vi.fn(),
}));

vi.mock('@/services/auth/auth-client', () => ({
  authClient: { resetPassword: mockedResetPassword },
}));

vi.mock('@/components/ui/Toast/toast-manager', () => ({ showSuccessToast: mockedToast }));

beforeEach(() => {
  vi.clearAllMocks();
  window.history.pushState({}, '', '/reset-password?token=tok-1');
  mockedResetPassword.mockResolvedValue({ data: { status: true }, error: null });
});

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

async function fill(password: string, confirmation: string): Promise<void> {
  await userEvent.type(screen.getByLabelText(/^New password/), password);
  await userEvent.type(screen.getByLabelText(/^Confirm password/), confirmation);
  await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
}

describe('ResetPassword', () => {
  it('sets the new password with the token from the link', async () => {
    render(<ResetPassword />);

    await fill('new-password-1', 'new-password-1');

    await waitFor(() =>
      expect(mockedResetPassword).toHaveBeenCalledWith({
        newPassword: 'new-password-1',
        token: 'tok-1',
      }),
    );
    expect(mockedToast).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Your password is changed/)).toBeInTheDocument();
  });

  it('refuses mismatching passwords', async () => {
    render(<ResetPassword />);

    await fill('new-password-1', 'other-password');

    expect(await screen.findByText('The passwords do not match.')).toBeInTheDocument();
    expect(mockedResetPassword).not.toHaveBeenCalled();
  });

  it('refuses a short password', async () => {
    render(<ResetPassword />);

    await fill('short', 'short');

    expect(await screen.findByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(mockedResetPassword).not.toHaveBeenCalled();
  });

  it('shows the engine refusal', async () => {
    mockedResetPassword.mockResolvedValue({ data: null, error: { message: 'Invalid token' } });

    render(<ResetPassword />);
    await fill('new-password-1', 'new-password-1');

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid token');
  });

  it('shows an invalid-link message without a token', () => {
    window.history.pushState({}, '', '/reset-password');

    render(<ResetPassword />);

    expect(screen.getByRole('alert')).toHaveTextContent('invalid or has expired');
    expect(screen.queryByLabelText(/^New password/)).not.toBeInTheDocument();
  });

  it('treats an error parameter as an invalid link', () => {
    window.history.pushState({}, '', '/reset-password?error=INVALID_TOKEN');

    render(<ResetPassword />);

    expect(screen.getByRole('alert')).toHaveTextContent('invalid or has expired');
  });
});
