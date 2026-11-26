import type { ReactElement } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { accountQueries } from '@/api/account/account-queries';
import type { AdminPageProps } from '@/lib/admin-page';
import { Button } from '@/components/ui/Button/Button';
import { PageHeader } from '@/components/ui/PageHeader/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import { Loader } from '@/components/ui/Loader/Loader';
import { LoadFailure } from '@/components/ui/LoadFailure/LoadFailure';
import { Typography } from '@/components/ui/Typography/Typography';
import { authClient } from '@/services/auth/auth-client';
import { DisableTwoFactorForm } from './components/DisableTwoFactorForm/DisableTwoFactorForm';
import { TwoFactorSetup } from './components/TwoFactorSetup/TwoFactorSetup';

type TwoFactorAction = 'enable' | 'disable' | null;

/** The signed-in operator's own settings: turning two-factor authentication on or off. */
export function AccountPage({ eyebrow, title }: AdminPageProps): ReactElement {
  const { data: session } = authClient.useSession();
  const hasPassword = useQuery({ ...accountQueries.hasPassword(), enabled: Boolean(session) });
  const [action, setAction] = useState<TwoFactorAction>(null);
  const isEnabled = session?.user.twoFactorEnabled === true;

  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title}>
        {session ? (
          <Typography variant="body-md" className="text-fg-3">
            {session.user.email}
          </Typography>
        ) : null}
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto p-8">
        {!session ? (
          <EmptyState
            title="No account to configure"
            body="Sign-in is off, so there is no signed-in operator."
          />
        ) : hasPassword.isPending ? (
          <Loader label="Loading your account…" />
        ) : hasPassword.isError ? (
          <LoadFailure
            error={hasPassword.error}
            subject="your account"
            onRetry={() => hasPassword.refetch()}
          />
        ) : (
          <section aria-labelledby="account-two-factor-heading" className="flex flex-col gap-4">
            <Typography
              variant="caps-tiny"
              as="h2"
              id="account-two-factor-heading"
              className="text-fg-3"
            >
              Two-factor authentication
            </Typography>
            {!hasPassword.data ? (
              <Typography variant="body-md" className="text-fg-3">
                You sign in with Microsoft, so your organization&#8217;s Microsoft account settings
                decide two-factor authentication.
              </Typography>
            ) : action === 'enable' ? (
              // Stays mounted after verification, when the session already says "on", until the
              // operator has seen the backup codes.
              <TwoFactorSetup onDone={() => setAction(null)} onCancel={() => setAction(null)} />
            ) : action === 'disable' && isEnabled ? (
              <DisableTwoFactorForm onCancel={() => setAction(null)} />
            ) : (
              <div className="flex flex-col items-start gap-4">
                <Typography variant="body-md" className="text-fg-1">
                  {isEnabled
                    ? 'On. Signing in asks for a code from your authenticator app.'
                    : 'Off. Turn it on to require a code from an authenticator app at sign-in.'}
                </Typography>
                <Button
                  variant={isEnabled ? 'outline' : 'primary'}
                  onClick={() => setAction(isEnabled ? 'disable' : 'enable')}
                >
                  {isEnabled ? 'Turn off' : 'Turn on'}
                </Button>
              </div>
            )}
          </section>
        )}
      </div>
    </>
  );
}
