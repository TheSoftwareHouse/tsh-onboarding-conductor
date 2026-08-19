import '@testing-library/jest-dom/vitest';
import {
  EventType,
  InteractionStatus,
  InteractionType,
  type EventMessage,
} from '@azure/msal-browser';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from './AuthGate';

const { mockedIsAuthEnabled, mockedUseMsal, mockedUseIsAuthenticated, mockedReadAuthConfig } =
  vi.hoisted(() => ({
    mockedIsAuthEnabled: vi.fn<() => boolean>(),
    mockedUseMsal: vi.fn(),
    mockedUseIsAuthenticated: vi.fn<() => boolean>(),
    mockedReadAuthConfig: vi.fn(),
  }));

vi.mock('../config/auth-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config/auth-config')>()),
  isAuthEnabled: mockedIsAuthEnabled,
  readAuthConfig: mockedReadAuthConfig,
}));

vi.mock('@azure/msal-react', () => ({
  useMsal: mockedUseMsal,
  useIsAuthenticated: mockedUseIsAuthenticated,
}));

type EventCallback = (message: EventMessage) => void;

const ACCOUNT = { username: 'anna@tsh.io', name: 'Anna Kowalska' };

function stubMsal(
  overrides: {
    inProgress?: InteractionStatus;
    accounts?: unknown[];
    activeAccount?: unknown;
  } = {},
) {
  const callbacks: EventCallback[] = [];
  const instance = {
    getActiveAccount: vi.fn(() => overrides.activeAccount ?? null),
    setActiveAccount: vi.fn(),
    addEventCallback: vi.fn((callback: EventCallback) => {
      callbacks.push(callback);

      return 'callback-id';
    }),
    removeEventCallback: vi.fn(),
  };

  mockedUseMsal.mockReturnValue({
    instance,
    inProgress: overrides.inProgress ?? InteractionStatus.None,
    accounts: overrides.accounts ?? [],
  });

  return {
    instance,
    // MSAL delivers these outside React's knowledge, so the resulting state update has to be
    // flushed explicitly for the rendered output to reflect it.
    emit: (message: EventMessage) =>
      act(() => {
        callbacks.forEach((callback) => callback(message));
      }),
  };
}

function event(
  eventType: EventType,
  error?: unknown,
  interactionType: InteractionType | null = null,
): EventMessage {
  return { eventType, error, interactionType, payload: null, timestamp: 0 } as EventMessage;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedIsAuthEnabled.mockReturnValue(true);
  mockedUseIsAuthenticated.mockReturnValue(true);
  mockedReadAuthConfig.mockReturnValue({
    provider: 'azure',
    clientId: 'client-id',
    tenantId: 'tenant-id',
    apiScope: 'api://engine-id/Onboardings.Read',
  });
});

afterEach(() => {
  cleanup();
});

describe('AuthGate', () => {
  it('renders the panel untouched when sign-in is switched off', () => {
    mockedIsAuthEnabled.mockReturnValue(false);

    render(
      <AuthGate>
        <p>admin table</p>
      </AuthGate>,
    );

    expect(screen.getByText('admin table')).toBeInTheDocument();
    expect(mockedUseMsal).not.toHaveBeenCalled();
  });

  it('renders the panel for a signed-in operator', () => {
    stubMsal({ activeAccount: ACCOUNT, accounts: [ACCOUNT] });

    render(
      <AuthGate>
        <p>admin table</p>
      </AuthGate>,
    );

    expect(screen.getByText('admin table')).toBeInTheDocument();
  });

  it('withholds the panel from a caller who is not signed in', () => {
    mockedUseIsAuthenticated.mockReturnValue(false);
    stubMsal();

    render(
      <AuthGate>
        <p>admin table</p>
      </AuthGate>,
    );

    expect(screen.queryByText('admin table')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in with microsoft/i })).toBeInTheDocument();
  });

  it.each([
    ['startup', InteractionStatus.Startup],
    ['the redirect coming back from Entra', InteractionStatus.HandleRedirect],
    ['sign-out', InteractionStatus.Logout],
  ])('shows progress rather than the sign-in screen during %s', (_label, inProgress) => {
    mockedUseIsAuthenticated.mockReturnValue(false);
    stubMsal({ inProgress });

    render(
      <AuthGate>
        <p>admin table</p>
      </AuthGate>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Signing in');
    expect(
      screen.queryByRole('button', { name: /sign in with microsoft/i }),
    ).not.toBeInTheDocument();
  });

  it('adopts the cached account so later token requests have someone to ask for', () => {
    const { instance } = stubMsal({ accounts: [ACCOUNT], activeAccount: null });

    render(
      <AuthGate>
        <p>admin table</p>
      </AuthGate>,
    );

    expect(instance.setActiveAccount).toHaveBeenCalledWith(ACCOUNT);
  });

  it('leaves an already-active account alone', () => {
    const { instance } = stubMsal({ accounts: [ACCOUNT], activeAccount: ACCOUNT });

    render(
      <AuthGate>
        <p>admin table</p>
      </AuthGate>,
    );

    expect(instance.setActiveAccount).not.toHaveBeenCalled();
  });

  describe('reporting a failed sign-in', () => {
    function renderUnauthenticated() {
      mockedUseIsAuthenticated.mockReturnValue(false);
      const msal = stubMsal();

      render(
        <AuthGate>
          <p>admin table</p>
        </AuthGate>,
      );

      return msal;
    }

    it.each([
      ['ACQUIRE_TOKEN_FAILURE', EventType.ACQUIRE_TOKEN_FAILURE],
      ['BROKERED_REQUEST_FAILURE', EventType.BROKERED_REQUEST_FAILURE],
    ])('surfaces the Entra error code reported by %s', (_label, eventType) => {
      // MsalProvider swallows redirect errors; without this the operator returns to the sign-in
      // screen with no explanation of what went wrong.
      const { emit } = renderUnauthenticated();

      emit(event(eventType, { errorCode: 'AADSTS50011', message: 'redirect URI mismatch' }));

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Sign-in failed (AADSTS50011): redirect URI mismatch',
      );
    });

    it('still says something useful when the failure carries no code', () => {
      const { emit } = renderUnauthenticated();

      emit(event(EventType.ACQUIRE_TOKEN_FAILURE, { message: 'popup closed' }));

      expect(screen.getByRole('alert')).toHaveTextContent('Sign-in failed: popup closed');
    });

    it('falls back to a bare message when the event carries no error at all', () => {
      const { emit } = renderUnauthenticated();

      emit(event(EventType.ACQUIRE_TOKEN_FAILURE));

      expect(screen.getByRole('alert')).toHaveTextContent('Sign-in failed.');
    });

    it.each([
      ['LOGIN_SUCCESS', EventType.LOGIN_SUCCESS],
      ['ACQUIRE_TOKEN_SUCCESS', EventType.ACQUIRE_TOKEN_SUCCESS],
    ])('clears a stale failure once %s arrives', (_label, eventType) => {
      const { emit } = renderUnauthenticated();

      emit(event(EventType.ACQUIRE_TOKEN_FAILURE, { errorCode: 'AADSTS50011', message: 'boom' }));
      expect(screen.getByRole('alert')).toBeInTheDocument();

      emit(event(eventType));

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('ignores events it has no opinion about', () => {
      const { emit } = renderUnauthenticated();

      emit(event(EventType.ACTIVE_ACCOUNT_CHANGED));

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('says nothing about a background renewal that failed', () => {
      // acquireTokenSilent runs on every request the panel makes, so this fires during ordinary
      // use. It describes a token refresh rather than a sign-in, and the gate cannot show it
      // while the operator is signed in — recording it would only leave a misleading string to
      // surface on the sign-in screen they eventually land on.
      const { emit } = renderUnauthenticated();

      emit(
        event(
          EventType.ACQUIRE_TOKEN_FAILURE,
          { errorCode: 'no_tokens_found', message: 'silent renewal failed' },
          InteractionType.Silent,
        ),
      );

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('still reports a failure from the redirect the operator is waiting on', () => {
      const { emit } = renderUnauthenticated();

      emit(
        event(
          EventType.ACQUIRE_TOKEN_FAILURE,
          { errorCode: 'AADSTS50011', message: 'redirect URI mismatch' },
          InteractionType.Redirect,
        ),
      );

      expect(screen.getByRole('alert')).toHaveTextContent('AADSTS50011');
    });

    it('does not keep a failure that the sign-in which followed has already answered', () => {
      mockedUseIsAuthenticated.mockReturnValue(false);
      const { emit } = stubMsal();
      const view = render(
        <AuthGate>
          <p>admin table</p>
        </AuthGate>,
      );

      emit(event(EventType.ACQUIRE_TOKEN_FAILURE, { errorCode: 'AADSTS50011', message: 'boom' }));
      expect(screen.getByRole('alert')).toBeInTheDocument();

      mockedUseIsAuthenticated.mockReturnValue(true);
      view.rerender(
        <AuthGate>
          <p>admin table</p>
        </AuthGate>,
      );
      expect(screen.getByText('admin table')).toBeInTheDocument();

      // Signing out later must not resurrect the failure that preceded the successful sign-in.
      mockedUseIsAuthenticated.mockReturnValue(false);
      view.rerender(
        <AuthGate>
          <p>admin table</p>
        </AuthGate>,
      );

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('when MSAL never finishes starting up', () => {
    // MsalProvider swallows a rejected initialize() and only leaves Startup on the success path,
    // so without a deadline a bad authority holds the panel on "Signing in…" for ever.
    function renderDuringStartup(inProgress: InteractionStatus = InteractionStatus.Startup) {
      mockedUseIsAuthenticated.mockReturnValue(false);
      stubMsal({ inProgress });

      render(
        <AuthGate>
          <p>admin table</p>
        </AuthGate>,
      );
    }

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('offers sign-in with an explanation rather than spinning for ever', () => {
      renderDuringStartup();
      expect(screen.getByRole('status')).toHaveTextContent('Signing in');

      act(() => {
        vi.advanceTimersByTime(15_000);
      });

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /sign in with microsoft/i })).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('Sign-in could not be started');
    });

    it('keeps waiting while startup is still within the deadline', () => {
      renderDuringStartup();

      act(() => {
        vi.advanceTimersByTime(14_000);
      });

      expect(screen.getByRole('status')).toHaveTextContent('Signing in');
    });

    it('does not time out the redirect coming back from Entra, which is not a stuck startup', () => {
      renderDuringStartup(InteractionStatus.HandleRedirect);

      act(() => {
        vi.advanceTimersByTime(60_000);
      });

      expect(screen.getByRole('status')).toHaveTextContent('Signing in');
    });
  });

  it('unsubscribes on unmount so a remounted gate does not accumulate listeners', () => {
    const { instance } = stubMsal({ activeAccount: ACCOUNT, accounts: [ACCOUNT] });
    const { unmount } = render(
      <AuthGate>
        <p>admin table</p>
      </AuthGate>,
    );

    unmount();

    expect(instance.removeEventCallback).toHaveBeenCalledWith('callback-id');
  });
});
