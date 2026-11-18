import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountPage } from './AccountPage';

const { mockedUseSession, mockedHasPassword } = vi.hoisted(() => ({
  mockedUseSession: vi.fn(),
  mockedHasPassword: vi.fn<() => Promise<boolean>>(),
}));

vi.mock('@/services/auth/auth-client', () => ({
  authClient: {
    useSession: mockedUseSession,
    twoFactor: { enable: vi.fn(), verifyTotp: vi.fn(), disable: vi.fn() },
  },
}));

vi.mock('@/api/account/account', () => ({
  fetchHasPassword: mockedHasPassword,
  disableTwoFactor: vi.fn(),
}));

function signedInAs(twoFactorEnabled: boolean): void {
  mockedUseSession.mockReturnValue({
    data: { user: { email: 'anna@tsh.io', twoFactorEnabled } },
  });
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AccountPage eyebrow="Account" title="Account" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedHasPassword.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
});

describe('AccountPage', () => {
  it('offers to turn two-factor on when it is off, and starts the setup', async () => {
    signedInAs(false);
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Turn on' }));

    expect(screen.getByText('Confirm your password to start.')).toBeInTheDocument();
  });

  it('offers to turn two-factor off when it is on, asking for the password', async () => {
    signedInAs(true);
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Turn off' }));

    expect(screen.getByLabelText(/^Password/)).toBeInTheDocument();
  });

  it('explains instead of offering a form to an operator without a password', async () => {
    signedInAs(false);
    mockedHasPassword.mockResolvedValue(false);
    renderPage();

    expect(await screen.findByText(/You sign in with Microsoft/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on' })).not.toBeInTheDocument();
  });
});
