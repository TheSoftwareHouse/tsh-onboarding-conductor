import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionBar } from './SessionBar';

const { mockedIsAuthEnabled, mockedUseMsal } = vi.hoisted(() => ({
  mockedIsAuthEnabled: vi.fn<() => boolean>(),
  mockedUseMsal: vi.fn(),
}));

vi.mock('../config/auth-config', () => ({
  isAuthEnabled: mockedIsAuthEnabled,
}));

vi.mock('@azure/msal-react', () => ({
  useMsal: mockedUseMsal,
}));

function stubMsal(
  overrides: { activeAccount?: unknown; accounts?: unknown[]; logoutRedirect?: () => unknown } = {},
) {
  const logoutRedirect = vi.fn(overrides.logoutRedirect ?? (() => Promise.resolve()));
  mockedUseMsal.mockReturnValue({
    instance: {
      getActiveAccount: vi.fn(() => overrides.activeAccount ?? null),
      getAllAccounts: vi.fn(() => overrides.accounts ?? []),
      logoutRedirect,
    },
  });

  return logoutRedirect;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedIsAuthEnabled.mockReturnValue(true);
});

afterEach(() => {
  cleanup();
});

describe('SessionBar', () => {
  it('renders nothing when sign-in is switched off, so local work shows no session chrome', () => {
    mockedIsAuthEnabled.mockReturnValue(false);

    const { container } = render(<SessionBar />);

    expect(container).toBeEmptyDOMElement();
    expect(mockedUseMsal).not.toHaveBeenCalled();
  });

  it('renders nothing when no account is known', () => {
    stubMsal();

    const { container } = render(<SessionBar />);

    expect(container).toBeEmptyDOMElement();
  });

  it('names the signed-in operator', () => {
    stubMsal({ activeAccount: { name: 'Anna Kowalska', username: 'anna@tsh.io' } });

    render(<SessionBar />);

    expect(screen.getByText('Anna Kowalska')).toBeInTheDocument();
  });

  it('falls back to the sign-in name when the directory supplies no display name', () => {
    stubMsal({ activeAccount: { name: undefined, username: 'anna@tsh.io' } });

    render(<SessionBar />);

    expect(screen.getByText('anna@tsh.io')).toBeInTheDocument();
  });

  it('falls back to the first cached account when none is active', () => {
    stubMsal({ activeAccount: null, accounts: [{ name: 'Cached Operator' }] });

    render(<SessionBar />);

    expect(screen.getByText('Cached Operator')).toBeInTheDocument();
  });

  it('signs the operator out through Entra rather than only clearing local state', async () => {
    const logoutRedirect = stubMsal({ activeAccount: { name: 'Anna Kowalska' } });
    render(<SessionBar />);

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(logoutRedirect).toHaveBeenCalledTimes(1);
  });
});
