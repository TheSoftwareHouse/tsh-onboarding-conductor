import type { ReactElement } from 'react';
import { useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { SSO_PROVIDERS, readAuthConfig } from '@/services/auth/auth-config';
import { Button } from '@/components/ui/Button/Button';
import { ArrowForward } from '@/components/ui/icons';
import { Typography } from '@/components/ui/Typography/Typography';
import { AuthShell } from '../AuthShell/AuthShell';

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
    <AuthShell>
      <div className="flex w-full max-w-110 flex-col gap-8 border border-border-hair bg-bg-page p-10">
        <div className="flex flex-col gap-3">
          <Typography variant="h5" as="h1">
            Admin onboardings
          </Typography>
          <Typography variant="body-md" className="text-fg-3">
            Sign in with your work account to continue.
          </Typography>
        </div>
        <Button
          variant="primary"
          size="xl"
          className="w-full justify-between"
          onClick={handleSignIn}
        >
          {SSO_PROVIDERS[provider].signInLabel}
          <ArrowForward aria-hidden className="size-5" />
        </Button>
        {visibleError ? (
          <Typography variant="body-sm" className="text-tsh-red" role="alert">
            {visibleError}
          </Typography>
        ) : null}
      </div>
    </AuthShell>
  );
}
