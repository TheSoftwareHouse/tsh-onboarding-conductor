import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignInPage } from './SignInPage';

const {
  mockedSocial,
  mockedSignInEmail,
  mockedRequestReset,
  mockedMicrosoftEnabled,
  mockedSuperadminTwoFactorRequired,
  mockedToast,
} = vi.hoisted(() => ({
  mockedSocial: vi.fn(),
  mockedSignInEmail: vi.fn(),
  mockedRequestReset: vi.fn(),
  mockedMicrosoftEnabled: vi.fn<() => boolean>(),
  mockedSuperadminTwoFactorRequired: vi.fn<() => boolean>(),
  mockedToast: vi.fn(),
}));

vi.mock('@/services/auth/auth-client', () => ({
  authClient: {
    signIn: { social: mockedSocial, email: mockedSignInEmail },
    requestPasswordReset: mockedRequestReset,
  },
}));

vi.mock('@/services/auth/auth-config', () => ({
  isMicrosoftSignInEnabled: mockedMicrosoftEnabled,
  isSuperadminTwoFactorRequired: mockedSuperadminTwoFactorRequired,
}));

vi.mock('@/components/ui/Toast/toast-manager', () => ({ showSuccessToast: mockedToast }));

async function fillAndSubmit(): Promise<void> {
  await userEvent.type(screen.getByLabelText(/^Email/), 'anna@tsh.io');
  await userEvent.type(screen.getByLabelText(/^Password/), 'secret-pass');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedMicrosoftEnabled.mockReturnValue(true);
  mockedSuperadminTwoFactorRequired.mockReturnValue(true);
  mockedSocial.mockResolvedValue({});
  mockedSignInEmail.mockResolvedValue({ data: { user: { twoFactorEnabled: true } }, error: null });
  mockedRequestReset.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
  cleanup();
});

describe('SignInPage', () => {
  it('starts Microsoft sign-in from the button', async () => {
    render(<SignInPage />);

    await userEvent.click(screen.getByRole('button', { name: /Sign in with Microsoft/ }));

    expect(mockedSocial).toHaveBeenCalledWith(expect.objectContaining({ provider: 'microsoft' }));
  });

  it('hides the Microsoft button when the engine has no Microsoft sign-in', () => {
    mockedMicrosoftEnabled.mockReturnValue(false);

    render(<SignInPage />);

    expect(screen.queryByRole('button', { name: /Microsoft/ })).not.toBeInTheDocument();
  });

  it('shows the error handed in', () => {
    render(<SignInPage error="Session lookup failed" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Session lookup failed');
  });

  it('shows a Microsoft sign-in start failure', async () => {
    mockedSocial.mockRejectedValue(new Error('popup blocked'));

    render(<SignInPage />);
    await userEvent.click(screen.getByRole('button', { name: /Sign in with Microsoft/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('popup blocked');
  });

  it('refuses an invalid email without calling the engine', async () => {
    render(<SignInPage />);

    await userEvent.type(screen.getByLabelText(/^Email/), 'not-an-email');
    await userEvent.type(screen.getByLabelText(/^Password/), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(mockedSignInEmail).not.toHaveBeenCalled();
  });

  it('signs in with email and password', async () => {
    const onTwoFactorRequired = vi.fn();
    const onTwoFactorSetupRequired = vi.fn();

    render(
      <SignInPage
        onTwoFactorRequired={onTwoFactorRequired}
        onTwoFactorSetupRequired={onTwoFactorSetupRequired}
      />,
    );
    await fillAndSubmit();

    await waitFor(() =>
      expect(mockedSignInEmail).toHaveBeenCalledWith({
        email: 'anna@tsh.io',
        password: 'secret-pass',
      }),
    );
    expect(onTwoFactorRequired).not.toHaveBeenCalled();
    expect(onTwoFactorSetupRequired).not.toHaveBeenCalled();
  });

  it('hands over to the TOTP challenge on twoFactorRedirect', async () => {
    mockedSignInEmail.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null });
    const onTwoFactorRequired = vi.fn();

    render(<SignInPage onTwoFactorRequired={onTwoFactorRequired} />);
    await fillAndSubmit();

    await waitFor(() => expect(onTwoFactorRequired).toHaveBeenCalledTimes(1));
  });

  it('asks for 2FA setup after a credential sign-in without 2FA', async () => {
    mockedSignInEmail.mockResolvedValue({
      data: { user: { twoFactorEnabled: false } },
      error: null,
    });
    const onTwoFactorSetupRequired = vi.fn();

    render(<SignInPage onTwoFactorSetupRequired={onTwoFactorSetupRequired} />);
    await fillAndSubmit();

    await waitFor(() => expect(onTwoFactorSetupRequired).toHaveBeenCalledTimes(1));
  });

  it.each([
    [true, 'required'],
    [false, 'offered'],
  ])('treats 2FA setup for a superadmin as %s -> %s', async (isRequired, expected) => {
    mockedSuperadminTwoFactorRequired.mockReturnValue(isRequired);
    mockedSignInEmail.mockResolvedValue({
      data: { user: { twoFactorEnabled: false, role: 'superadmin' } },
      error: null,
    });
    const onTwoFactorSetupRequired = vi.fn();
    const onTwoFactorSetupOffered = vi.fn();

    render(
      <SignInPage
        onTwoFactorSetupRequired={onTwoFactorSetupRequired}
        onTwoFactorSetupOffered={onTwoFactorSetupOffered}
      />,
    );
    await fillAndSubmit();

    const [called, notCalled] =
      expected === 'required'
        ? [onTwoFactorSetupRequired, onTwoFactorSetupOffered]
        : [onTwoFactorSetupOffered, onTwoFactorSetupRequired];
    await waitFor(() => expect(called).toHaveBeenCalledTimes(1));
    expect(notCalled).not.toHaveBeenCalled();
  });

  it('still requires 2FA setup from a non-superadmin when superadmin 2FA is optional', async () => {
    mockedSuperadminTwoFactorRequired.mockReturnValue(false);
    mockedSignInEmail.mockResolvedValue({
      data: { user: { twoFactorEnabled: false, role: 'user' } },
      error: null,
    });
    const onTwoFactorSetupRequired = vi.fn();

    render(<SignInPage onTwoFactorSetupRequired={onTwoFactorSetupRequired} />);
    await fillAndSubmit();

    await waitFor(() => expect(onTwoFactorSetupRequired).toHaveBeenCalledTimes(1));
  });

  it('shows the engine refusal', async () => {
    mockedSignInEmail.mockResolvedValue({
      data: null,
      error: { message: 'Invalid email or password' },
    });

    render(<SignInPage />);
    await fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('requests a password reset link pointing at the reset route', async () => {
    render(<SignInPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Forgot password' }));
    await userEvent.type(screen.getByLabelText(/^Email/), 'anna@tsh.io');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    await waitFor(() =>
      expect(mockedRequestReset).toHaveBeenCalledWith({
        email: 'anna@tsh.io',
        redirectTo: `${window.location.origin}/reset-password`,
      }),
    );
    expect(mockedToast).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});
