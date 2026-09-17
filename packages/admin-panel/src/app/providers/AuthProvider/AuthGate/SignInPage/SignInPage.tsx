import type { ReactElement } from 'react';
import { useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { SSO_PROVIDERS, readAuthConfig } from '@/services/auth/auth-config';
import { Button } from '@/components/ui/Button/Button';

export interface SignInPageProps {
  /** Failure reported by MSAL for an earlier attempt, typically a redirect that came back broken. */
  error?: string | null;
}

/** Sign-in screen shown in place of the panel until an account is present. */
export function SignInPage({ error = null }: SignInPageProps): ReactElement {
  const { instance } = useMsal();
  // Safe to read during render: the client this page needs is built from the same configuration,
  // so an unreadable one would have failed before the gate ever rendered.
  const { apiScope, provider } = readAuthConfig();
  const [startError, setStartError] = useState<string | null>(null);
  const visibleError = startError ?? error;

  const handleSignIn = (): void => {
    setStartError(null);

    // Requesting the engine scope during sign-in gets consent out of the way up front, so the
    // first data request can be served silently from the cache.
    instance.loginRedirect({ scopes: [apiScope] }).catch((cause: unknown) => {
      setStartError(cause instanceof Error ? cause.message : 'Sign-in could not be started.');
    });
  };

  return (
    <div className="page auth-page">
      <div className="auth-card">
        <h1>Admin onboardings</h1>
        <p className="auth-card__hint">Sign in with your work account to continue.</p>
        <Button variant="primary" onClick={handleSignIn}>
          {SSO_PROVIDERS[provider].signInLabel}
        </Button>
        {visibleError ? (
          <p className="field-error" role="alert">
            {visibleError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
