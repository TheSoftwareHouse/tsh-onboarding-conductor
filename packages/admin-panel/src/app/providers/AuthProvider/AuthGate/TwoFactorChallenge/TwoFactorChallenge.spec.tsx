import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwoFactorChallenge } from './TwoFactorChallenge';

const { mockedVerifyTotp, mockedVerifyBackup } = vi.hoisted(() => ({
  mockedVerifyTotp: vi.fn(),
  mockedVerifyBackup: vi.fn(),
}));

vi.mock('@/services/auth/auth-client', () => ({
  authClient: {
    twoFactor: { verifyTotp: mockedVerifyTotp, verifyBackupCode: mockedVerifyBackup },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockedVerifyTotp.mockResolvedValue({ data: {}, error: null });
  mockedVerifyBackup.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
  cleanup();
});

describe('TwoFactorChallenge', () => {
  it('verifies an authenticator code and trusts the device when asked', async () => {
    const onVerified = vi.fn();
    render(<TwoFactorChallenge onVerified={onVerified} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/^Authenticator code/), '123456');
    await userEvent.click(screen.getByLabelText('Trust this device'));
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() =>
      expect(mockedVerifyTotp).toHaveBeenCalledWith({ code: '123456', trustDevice: true }),
    );
    expect(onVerified).toHaveBeenCalledTimes(1);
  });

  it('falls back to a backup code', async () => {
    render(<TwoFactorChallenge onVerified={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Use a backup code' }));
    await userEvent.type(screen.getByLabelText(/^Backup code/), 'abcd-1234');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() =>
      expect(mockedVerifyBackup).toHaveBeenCalledWith({ code: 'abcd-1234', trustDevice: false }),
    );
    expect(mockedVerifyTotp).not.toHaveBeenCalled();
  });

  it('refuses an empty code', async () => {
    render(<TwoFactorChallenge onVerified={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByText('Enter the code.')).toBeInTheDocument();
    expect(mockedVerifyTotp).not.toHaveBeenCalled();
  });

  it('shows a rejected code and stays on the challenge', async () => {
    mockedVerifyTotp.mockResolvedValue({ data: null, error: { message: 'Invalid code' } });
    const onVerified = vi.fn();
    render(<TwoFactorChallenge onVerified={onVerified} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/^Authenticator code/), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid code');
    expect(onVerified).not.toHaveBeenCalled();
  });

  it('returns to sign-in on cancel', async () => {
    const onCancel = vi.fn();
    render(<TwoFactorChallenge onVerified={vi.fn()} onCancel={onCancel} />);

    await userEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
