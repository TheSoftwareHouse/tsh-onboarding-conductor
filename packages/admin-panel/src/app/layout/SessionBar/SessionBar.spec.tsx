import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionBar } from './SessionBar';

const { mockedIsAuthEnabled, mockedUseSession, mockedSignOut } = vi.hoisted(() => ({
  mockedIsAuthEnabled: vi.fn<() => boolean>(),
  mockedUseSession: vi.fn(),
  mockedSignOut: vi.fn(),
}));

vi.mock('@/services/auth/auth-config', () => ({
  isAuthEnabled: mockedIsAuthEnabled,
}));

vi.mock('./OrganizationSwitcher/OrganizationSwitcher', () => ({
  OrganizationSwitcher: () => <div>organization switcher</div>,
}));

vi.mock('@/services/auth/auth-client', () => ({
  authClient: { useSession: mockedUseSession, signOut: mockedSignOut },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockedIsAuthEnabled.mockReturnValue(true);
  mockedSignOut.mockResolvedValue({});
  mockedUseSession.mockReturnValue({
    data: { user: { name: 'Anna Kowalska', email: 'anna@tsh.io' } },
  });
});

afterEach(() => {
  cleanup();
});

describe('SessionBar', () => {
  it('renders nothing when sign-in is switched off, so local work shows no session chrome', () => {
    mockedIsAuthEnabled.mockReturnValue(false);

    const { container } = render(<SessionBar />);

    expect(container).toBeEmptyDOMElement();
    expect(mockedUseSession).not.toHaveBeenCalled();
  });

  it('renders nothing without a session', () => {
    mockedUseSession.mockReturnValue({ data: null });

    const { container } = render(<SessionBar />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the signed-in operator email and their initials', () => {
    render(<SessionBar />);

    expect(screen.getByText('anna@tsh.io')).toBeInTheDocument();
    expect(screen.getByText('AK')).toBeInTheDocument();
  });

  it('derives the initials from the email when the user has no display name', () => {
    mockedUseSession.mockReturnValue({ data: { user: { name: '', email: 'anna@tsh.io' } } });

    render(<SessionBar />);

    expect(screen.getByText('AT')).toBeInTheDocument();
  });

  it('mounts the organization switcher', () => {
    render(<SessionBar />);

    expect(screen.getByText('organization switcher')).toBeInTheDocument();
  });

  it('signs out from the button', async () => {
    render(<SessionBar />);

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(mockedSignOut).toHaveBeenCalledTimes(1);
  });
});
