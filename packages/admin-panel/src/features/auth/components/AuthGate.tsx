import type { ReactElement, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { EventType, InteractionStatus, type EventMessage } from '@azure/msal-browser';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { isAuthEnabled } from '../config/auth-config';
import { SignInPage } from './SignInPage';

export interface AuthGateProps {
  children: ReactNode;
}

// MSAL v5 has no LOGIN_FAILURE: a failed redirect sign-in surfaces as ACQUIRE_TOKEN_FAILURE.
const FAILURE_EVENTS: readonly string[] = [
  EventType.ACQUIRE_TOKEN_FAILURE,
  EventType.BROKERED_REQUEST_FAILURE,
];

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

  useEffect(() => {
    if (!instance.getActiveAccount() && accounts.length > 0) {
      instance.setActiveAccount(accounts[0]);
    }
  }, [accounts, instance]);

  useEffect(() => {
    // MsalProvider deliberately swallows redirect errors and expects them to be observed here.
    // Without this the browser simply returns to the sign-in screen with no explanation.
    const callbackId = instance.addEventCallback((message: EventMessage) => {
      if (FAILURE_EVENTS.includes(message.eventType)) {
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

  // Covers MSAL's startup, the redirect coming back from Entra, and sign-out.
  if (inProgress !== InteractionStatus.None) {
    return (
      <div className="page auth-page">
        <p className="status-region" role="status">
          Signing in&#8230;
        </p>
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
