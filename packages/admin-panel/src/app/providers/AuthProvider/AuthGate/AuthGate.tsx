import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import { StatusRegion } from '@/components/ui/StatusRegion/StatusRegion';
import { authClient } from '@/services/auth/auth-client';
import { isAuthEnabled } from '@/services/auth/auth-config';
import { AuthShell } from './AuthShell/AuthShell';
import { RESET_PASSWORD_PATH, ResetPassword } from './ResetPassword/ResetPassword';
import { SignInPage } from './SignInPage/SignInPage';
import { TwoFactorChallenge } from './TwoFactorChallenge/TwoFactorChallenge';

export interface AuthGateProps {
  children: ReactNode;
}

function SignedInGate({ children }: AuthGateProps): ReactElement {
  const { data: session, isPending, error } = authClient.useSession();
  const [isChallenged, setIsChallenged] = useState(false);
  // better-auth flags a refetch (after every sign-in) as pending too, with the old data still
  // there; only the first load may replace the screen, or a half-typed 2FA code is wiped.
  const [hasLoaded, setHasLoaded] = useState(false);

  if (!isPending && !hasLoaded) {
    setHasLoaded(true);
  }

  // The challenge flag describes one operator's sign-in; it must not outlive it and greet the next
  // one. Reset on the signed-in -> signed-out edge only.
  const [wasSignedIn, setWasSignedIn] = useState(false);
  const isSignedIn = Boolean(session);

  if (isSignedIn !== wasSignedIn) {
    setWasSignedIn(isSignedIn);

    if (!isSignedIn) {
      setIsChallenged(false);
    }
  }

  if (isPending && !hasLoaded) {
    return (
      <AuthShell>
        <StatusRegion>Signing in&#8230;</StatusRegion>
      </AuthShell>
    );
  }

  if (!session) {
    return isChallenged ? (
      <TwoFactorChallenge
        onVerified={() => setIsChallenged(false)}
        onCancel={() => setIsChallenged(false)}
      />
    ) : (
      <SignInPage
        error={error?.message ?? null}
        onTwoFactorRequired={() => setIsChallenged(true)}
      />
    );
  }

  return <>{children}</>;
}

/**
 * Renders the panel only for a signed-in operator. This gate decides whether the UI appears;
 * the engine's own session check is what actually protects the data.
 */
export function AuthGate({ children }: AuthGateProps): ReactElement {
  if (!isAuthEnabled()) {
    return <>{children}</>;
  }

  // Sits above the router, so the mailed reset link is matched on the raw location.
  if (window.location.pathname.replace(/\/+$/, '') === RESET_PASSWORD_PATH) {
    return <ResetPassword />;
  }

  return <SignedInGate>{children}</SignedInGate>;
}
