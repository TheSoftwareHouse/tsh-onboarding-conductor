import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api/api-error';
import { AuthGate } from './AuthGate';

const { mockedIsAuthEnabled, mockedUseSession, mockedSignInEmail } = vi.hoisted(() => ({
  mockedIsAuthEnabled: vi.fn<() => boolean>(),
  mockedUseSession: vi.fn(),
  mockedSignInEmail: vi.fn(),
}));

vi.mock('@/services/auth/auth-config', () => ({
  isAuthEnabled: mockedIsAuthEnabled,
  isMicrosoftSignInEnabled: () => false,
}));

vi.mock('@/services/auth/auth-client', () => ({
  authClient: {
    useSession: mockedUseSession,
    signIn: { social: vi.fn(), email: mockedSignInEmail },
    twoFactor: { enable: vi.fn(), verifyTotp: vi.fn(), verifyBackupCode: vi.fn() },
    resetPassword: vi.fn(),
  },
}));

let queryClient: QueryClient;

function gateElement() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        <p>admin table</p>
      </AuthGate>
    </QueryClientProvider>
  );
}

function renderGate() {
  return render(gateElement());
}

async function failQueryWith(error: ApiError): Promise<void> {
  await act(async () => {
    await queryClient
      .fetchQuery({
        queryKey: ['probe'],
        queryFn: () => Promise.reject(error),
        retry: false,
      })
      .catch(() => undefined);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient();
  mockedIsAuthEnabled.mockReturnValue(true);
  mockedUseSession.mockReturnValue({ data: { user: { email: 'anna@tsh.io' } }, isPending: false });
});

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

describe('AuthGate', () => {
  it('renders the panel untouched when sign-in is switched off', () => {
    mockedIsAuthEnabled.mockReturnValue(false);

    renderGate();

    expect(screen.getByText('admin table')).toBeInTheDocument();
    expect(mockedUseSession).not.toHaveBeenCalled();
  });

  it('renders the panel for a signed-in operator', () => {
    renderGate();

    expect(screen.getByText('admin table')).toBeInTheDocument();
  });

  it('shows progress while the session is loading', () => {
    mockedUseSession.mockReturnValue({ data: null, isPending: true });

    renderGate();

    expect(screen.getByText(/Signing in/)).toBeInTheDocument();
    expect(screen.queryByText('admin table')).not.toBeInTheDocument();
  });

  it('shows the sign-in page without a session, hiding the panel', () => {
    mockedUseSession.mockReturnValue({ data: null, isPending: false });

    renderGate();

    expect(screen.getByRole('heading', { name: 'Admin onboardings' })).toBeInTheDocument();
    expect(screen.queryByText('admin table')).not.toBeInTheDocument();
  });

  it('shows the reset-password page without a session on the mailed link', () => {
    mockedUseSession.mockReturnValue({ data: null, isPending: false });
    window.history.pushState({}, '', '/reset-password?token=tok-1');

    renderGate();

    expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
    expect(mockedUseSession).not.toHaveBeenCalled();
  });

  it('shows the TOTP challenge after the sign-in answers twoFactorRedirect', async () => {
    mockedUseSession.mockReturnValue({ data: null, isPending: false });
    mockedSignInEmail.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null });
    const { default: userEvent } = await import('@testing-library/user-event');

    renderGate();
    await userEvent.type(screen.getByLabelText(/^Email/), 'anna@tsh.io');
    await userEvent.type(screen.getByLabelText(/^Password/), 'secret-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { name: 'Two-factor verification' }),
    ).toBeInTheDocument();
  });

  it('shows the 2FA setup screen after a credential sign-in without 2FA', async () => {
    mockedUseSession.mockReturnValue({ data: null, isPending: false });
    // A successful sign-in leaves a session behind; the gate then reads it on the next render.
    mockedSignInEmail.mockImplementation(() => {
      mockedUseSession.mockReturnValue({
        data: { user: { email: 'anna@tsh.io' } },
        isPending: false,
      });
      return Promise.resolve({ data: { user: { twoFactorEnabled: false } }, error: null });
    });
    const { default: userEvent } = await import('@testing-library/user-event');

    renderGate();
    await userEvent.type(screen.getByLabelText(/^Email/), 'anna@tsh.io');
    await userEvent.type(screen.getByLabelText(/^Password/), 'secret-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { name: 'Set up two-factor authentication' }),
    ).toBeInTheDocument();
  });

  it('swaps the panel for the 2FA setup screen when the engine answers 403 TWO_FACTOR_REQUIRED', async () => {
    renderGate();

    await failQueryWith(
      new ApiError('Two-factor required', { status: 403, code: 'TWO_FACTOR_REQUIRED' }),
    );

    expect(
      screen.getByRole('heading', { name: 'Set up two-factor authentication' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('admin table')).not.toBeInTheDocument();
  });

  it('keeps the panel for a 403 that is not a missing second factor', async () => {
    renderGate();

    await failQueryWith(
      new ApiError('Missing permission', { status: 403, code: 'ADMIN_PERMISSION_MISSING' }),
    );

    expect(screen.getByText('admin table')).toBeInTheDocument();
  });

  it('keeps the TOTP challenge mounted while the session refetches after sign-in', async () => {
    mockedUseSession.mockReturnValue({ data: null, isPending: false });
    mockedSignInEmail.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null });
    const { default: userEvent } = await import('@testing-library/user-event');

    const { rerender } = renderGate();
    await userEvent.type(screen.getByLabelText(/^Email/), 'anna@tsh.io');
    await userEvent.type(screen.getByLabelText(/^Password/), 'secret-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await userEvent.type(await screen.findByLabelText(/^Authenticator code/), '123');

    mockedUseSession.mockReturnValue({ data: null, isPending: true });
    rerender(gateElement());

    expect(screen.queryByText(/Signing in/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Authenticator code/)).toHaveValue('123');
  });

  it('keeps the 2FA setup screen mounted while the session refetches', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const { rerender } = renderGate();
    await failQueryWith(
      new ApiError('Two-factor required', { status: 403, code: 'TWO_FACTOR_REQUIRED' }),
    );
    await userEvent.type(screen.getByLabelText(/^Password/), 'secret-pass');

    mockedUseSession.mockReturnValue({ data: { user: { email: 'anna@tsh.io' } }, isPending: true });
    rerender(gateElement());

    expect(screen.queryByText(/Signing in/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Password/)).toHaveValue('secret-pass');
  });

  it('does not show the 2FA setup screen to the next operator after a sign-out', async () => {
    const { rerender } = renderGate();
    await failQueryWith(
      new ApiError('Two-factor required', { status: 403, code: 'TWO_FACTOR_REQUIRED' }),
    );
    expect(
      screen.getByRole('heading', { name: 'Set up two-factor authentication' }),
    ).toBeInTheDocument();

    mockedUseSession.mockReturnValue({ data: null, isPending: false });
    rerender(gateElement());
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();

    mockedUseSession.mockReturnValue({ data: { user: { email: 'bob@tsh.io' } }, isPending: false });
    rerender(gateElement());

    expect(screen.getByText('admin table')).toBeInTheDocument();
  });
});
