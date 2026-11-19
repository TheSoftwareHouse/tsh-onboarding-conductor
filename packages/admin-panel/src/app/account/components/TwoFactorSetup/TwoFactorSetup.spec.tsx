import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwoFactorSetup } from './TwoFactorSetup';

const { mockedEnable, mockedVerifyTotp } = vi.hoisted(() => ({
  mockedEnable: vi.fn(),
  mockedVerifyTotp: vi.fn(),
}));

vi.mock('@/services/auth/auth-client', () => ({
  authClient: { twoFactor: { enable: mockedEnable, verifyTotp: mockedVerifyTotp } },
}));

vi.mock('@/components/ui/Toast/toast-manager', () => ({ showSuccessToast: vi.fn() }));

const TOTP_URI = 'otpauth://totp/TSH:anna@tsh.io?secret=JBSWY3DPEHPK3PXP&issuer=TSH';

async function enrollWithPassword(): Promise<void> {
  await userEvent.type(screen.getByLabelText(/^Password/), 'secret-pass');
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedEnable.mockResolvedValue({
    data: { method: 'totp', totpURI: TOTP_URI, backupCodes: ['aaaa-1111', 'bbbb-2222'] },
    error: null,
  });
  mockedVerifyTotp.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
  cleanup();
});

describe('TwoFactorSetup', () => {
  it('cancels before verification', async () => {
    const onCancel = vi.fn();
    render(<TwoFactorSetup onDone={vi.fn()} onCancel={onCancel} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('asks for the password first and sends it to enable', async () => {
    render(<TwoFactorSetup onDone={vi.fn()} onCancel={vi.fn()} />);

    await enrollWithPassword();

    await waitFor(() => expect(mockedEnable).toHaveBeenCalledWith({ password: 'secret-pass' }));
  });

  it('shows the QR code and the secret as text after enrolment', async () => {
    render(<TwoFactorSetup onDone={vi.fn()} onCancel={vi.fn()} />);

    await enrollWithPassword();

    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    expect(screen.getByTitle('Authenticator setup QR code')).toBeInTheDocument();
  });

  it('shows a wrong password and does not advance', async () => {
    mockedEnable.mockResolvedValue({ data: null, error: { message: 'Invalid password' } });

    render(<TwoFactorSetup onDone={vi.fn()} onCancel={vi.fn()} />);
    await enrollWithPassword();

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid password');
    expect(screen.queryByText('JBSWY3DPEHPK3PXP')).not.toBeInTheDocument();
  });

  it('verifies the first code, then shows backup codes once and finishes on confirm', async () => {
    const onDone = vi.fn();
    render(<TwoFactorSetup onDone={onDone} onCancel={vi.fn()} />);

    await enrollWithPassword();
    await userEvent.type(await screen.findByLabelText(/^Code from your app/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and enable' }));

    await waitFor(() => expect(mockedVerifyTotp).toHaveBeenCalledWith({ code: '123456' }));
    expect(await screen.findByText('aaaa-1111')).toBeInTheDocument();
    expect(screen.getByText('bbbb-2222')).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'I have saved my backup codes' }));

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('keeps the operator on the code step when the first code is wrong', async () => {
    mockedVerifyTotp.mockResolvedValue({ data: null, error: { message: 'Invalid code' } });

    render(<TwoFactorSetup onDone={vi.fn()} onCancel={vi.fn()} />);
    await enrollWithPassword();
    await userEvent.type(await screen.findByLabelText(/^Code from your app/), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and enable' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid code');
    expect(screen.queryByText('aaaa-1111')).not.toBeInTheDocument();
  });
});
