import type { ReactElement, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { StatusRegion } from '@/components/ui/StatusRegion/StatusRegion';
import { ApiError } from '@/services/api/api-error';
import { authClient } from '@/services/auth/auth-client';
import { isAuthEnabled } from '@/services/auth/auth-config';
import { AuthShell } from './AuthShell/AuthShell';
import { RESET_PASSWORD_PATH, ResetPassword } from './ResetPassword/ResetPassword';
import { SignInPage } from './SignInPage/SignInPage';
import { TwoFactorChallenge } from './TwoFactorChallenge/TwoFactorChallenge';
import { TwoFactorSetup } from './TwoFactorSetup/TwoFactorSetup';

export interface AuthGateProps {
  children: ReactNode;
}

/** The engine's answer to a credential account that has not enrolled in two-factor authentication. */
const TWO_FACTOR_REQUIRED_CODE = 'TWO_FACTOR_REQUIRED';

function isTwoFactorRequired(error: unknown): boolean {
  return (
    error instanceof ApiError && error.status === 403 && error.code === TWO_FACTOR_REQUIRED_CODE
  );
}

/** True once any query or mutation the panel runs fails with `403 TWO_FACTOR_REQUIRED`. */
function useTwoFactorSetupRequired(): [boolean, (value: boolean) => void] {
  const queryClient = useQueryClient();
  const [isRequired, setIsRequired] = useState(false);

  useEffect(() => {
    const unsubscribeQueries = queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type === 'updated' &&
        event.action.type === 'error' &&
        isTwoFactorRequired(event.action.error)
      ) {
        setIsRequired(true);
      }
    });
    const unsubscribeMutations = queryClient.getMutationCache().subscribe((event) => {
      if (
        event.type === 'updated' &&
        event.action.type === 'error' &&
        isTwoFactorRequired(event.action.error)
      ) {
        setIsRequired(true);
      }
    });

    return () => {
      unsubscribeQueries();
      unsubscribeMutations();
    };
  }, [queryClient]);

  return [isRequired, setIsRequired];
}

function SignedInGate({ children }: AuthGateProps): ReactElement {
  const queryClient = useQueryClient();
  const { data: session, isPending, error } = authClient.useSession();
  const [isChallenged, setIsChallenged] = useState(false);
  const [isSetupRequired, setIsSetupRequired] = useTwoFactorSetupRequired();
  const [isSetupOffered, setIsSetupOffered] = useState(false);
  // better-auth flags a refetch (after every sign-in) as pending too, with the old data still
  // there; only the first load may replace the screen, or a half-typed 2FA code is wiped.
  const [hasLoaded, setHasLoaded] = useState(false);

  if (!isPending && !hasLoaded) {
    setHasLoaded(true);
  }

  // The flags describe one operator's sign-in; they must not outlive it and greet the next one.
  // Reset on the signed-in -> signed-out edge only: the sign-in form raises the setup flag just
  // before the session it belongs to appears.
  const [wasSignedIn, setWasSignedIn] = useState(false);
  const isSignedIn = Boolean(session);

  if (isSignedIn !== wasSignedIn) {
    setWasSignedIn(isSignedIn);

    if (!isSignedIn) {
      setIsChallenged(false);
      setIsSetupRequired(false);
      setIsSetupOffered(false);
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
        onTwoFactorSetupRequired={() => setIsSetupRequired(true)}
        onTwoFactorSetupOffered={() => setIsSetupOffered(true)}
      />
    );
  }

  if (isSetupRequired || isSetupOffered) {
    return (
      <TwoFactorSetup
        // An engine 403 makes setup mandatory even after the panel offered it as optional.
        onSkip={isSetupRequired ? undefined : () => setIsSetupOffered(false)}
        onDone={() => {
          setIsSetupRequired(false);
          setIsSetupOffered(false);
          // Requests that were refused while 2FA was missing are stale; refetch them on mount.
          void queryClient.invalidateQueries();
        }}
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
