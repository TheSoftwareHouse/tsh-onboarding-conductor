import type { ReactElement, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import {
  EventType,
  InteractionStatus,
  InteractionType,
  type EventMessage,
} from '@azure/msal-browser';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { StatusRegion } from '@/components/ui/StatusRegion/StatusRegion';
import { isAuthEnabled } from '@/services/auth/auth-config';
import { SignInPage } from './SignInPage/SignInPage';

export interface AuthGateProps {
  children: ReactNode;
}

// MSAL v5 has no LOGIN_FAILURE: a failed redirect sign-in surfaces as ACQUIRE_TOKEN_FAILURE.
const FAILURE_EVENTS: readonly string[] = [
  EventType.ACQUIRE_TOKEN_FAILURE,
  EventType.BROKERED_REQUEST_FAILURE,
];

/**
 * How long MSAL may stay in `Startup` before the gate stops waiting on it. `MsalProvider`
 * swallows a rejected `initialize()` and only leaves `Startup` on the success path, so a bad
 * authority or a blocked network would otherwise hold the panel on "Signing in…" indefinitely
 * with nothing said about why.
 */
const STARTUP_TIMEOUT_MS = 15_000;

const STARTUP_TIMEOUT_MESSAGE =
  'Sign-in could not be started. Reload the page, and check the panel’s Entra configuration if this persists.';

/**
 * Whether the failure came from an attempt the operator is actually waiting on.
 *
 * `acquireTokenSilent` runs on every request the panel makes, so a background renewal failing —
 * an expired session, a revoked consent — raises `ACQUIRE_TOKEN_FAILURE` during ordinary use.
 * Its message describes a token refresh rather than a sign-in, and this gate can never render it
 * while the operator is signed in, so recording it would only leave a misleading string to be
 * shown on the sign-in screen they eventually land on.
 */
function isInteractiveFailure(message: EventMessage): boolean {
  return message.interactionType !== InteractionType.Silent;
}

function describeAuthFailure(message: EventMessage): string {
  const error = message.error;

  if (!error) {
    return 'Sign-in failed.';
  }

  // The Entra error code (AADSTS…) is the part that identifies the misconfiguration, so it is
  // shown rather than hidden behind a generic message.
  const code = 'errorCode' in error && error.errorCode ? error.errorCode : null;

  return code ? `Sign-in failed (${code}): ${error.message}` : `Sign-in failed: ${error.message}`;
}

function SignedInGate({ children }: AuthGateProps): ReactElement {
  const { instance, inProgress, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [authError, setAuthError] = useState<string | null>(null);
  const [startupTimedOut, setStartupTimedOut] = useState(false);
  const isStartingUp = inProgress === InteractionStatus.Startup;

  useEffect(() => {
    if (!instance.getActiveAccount() && accounts.length > 0) {
      instance.setActiveAccount(accounts[0]);
    }
  }, [accounts, instance]);

  useEffect(() => {
    if (!isStartingUp) {
      setStartupTimedOut(false);

      return;
    }

    const timer = window.setTimeout(() => setStartupTimedOut(true), STARTUP_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [isStartingUp]);

  // A failure reported before sign-in completed has been answered by the sign-in that followed,
  // so it must not survive to be shown the next time the operator reaches the sign-in screen.
  useEffect(() => {
    if (isAuthenticated) {
      setAuthError(null);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    // MsalProvider deliberately swallows redirect errors and expects them to be observed here.
    // Without this the browser simply returns to the sign-in screen with no explanation.
    const callbackId = instance.addEventCallback((message: EventMessage) => {
      if (FAILURE_EVENTS.includes(message.eventType) && isInteractiveFailure(message)) {
        setAuthError(describeAuthFailure(message));
      } else if (
        message.eventType === EventType.LOGIN_SUCCESS ||
        message.eventType === EventType.ACQUIRE_TOKEN_SUCCESS
      ) {
        setAuthError(null);
      }
    });

    return () => {
      if (callbackId) {
        instance.removeEventCallback(callbackId);
      }
    };
  }, [instance]);

  // MSAL never came up. Offering sign-in is more use than a spinner that will not resolve: the
  // attempt reports its own failure if the client is still unusable.
  if (isStartingUp && startupTimedOut) {
    return <SignInPage error={authError ?? STARTUP_TIMEOUT_MESSAGE} />;
  }

  // Covers MSAL's startup, the redirect coming back from Entra, and sign-out.
  if (inProgress !== InteractionStatus.None) {
    return (
      <div className="page auth-page">
        <StatusRegion>Signing in&#8230;</StatusRegion>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <SignInPage error={authError} />;
  }

  return <>{children}</>;
}

/**
 * Renders the panel only for a signed-in operator. This gate decides whether the UI appears;
 * the engine's own token verification is what actually protects the data.
 */
export function AuthGate({ children }: AuthGateProps): ReactElement {
  if (!isAuthEnabled()) {
    return <>{children}</>;
  }

  return <SignedInGate>{children}</SignedInGate>;
}
