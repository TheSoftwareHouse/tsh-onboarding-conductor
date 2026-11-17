import type { ReactElement } from 'react';
import { Button } from '@/components/ui/Button/Button';
import { Logout } from '@/components/ui/icons';
import { Typography } from '@/components/ui/Typography/Typography';
import { OrganizationSwitcher } from './OrganizationSwitcher/OrganizationSwitcher';
import { authClient } from '@/services/auth/auth-client';
import { isAuthEnabled } from '@/services/auth/auth-config';

/** First letter of the first two words, so "Anna Kowalska" reads as AK and an address as A. */
function buildInitials(name: string): string {
  return name
    .split(/[\s.@_-]+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

function SignedInSessionBar(): ReactElement | null {
  const { data: session } = authClient.useSession();

  if (!session) {
    return null;
  }

  const name = session.user.name || session.user.email;

  return (
    <div className="flex flex-none flex-col gap-3 border-t border-border-rule px-6 py-4">
      <OrganizationSwitcher />
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-8 flex-none items-center justify-center bg-bg-alt text-caps-tiny text-fg-1"
        >
          {buildInitials(name)}
        </span>
        <Typography variant="body-sm" className="min-w-0 flex-1 truncate text-fg-1">
          {session.user.email}
        </Typography>
        <Button
          variant="quiet"
          size="md"
          aria-label="Sign out"
          title="Sign out"
          className="px-2"
          onClick={() => void authClient.signOut()}
        >
          <Logout aria-hidden className="size-5" />
        </Button>
      </div>
    </div>
  );
}

/** Sidebar footer naming the signed-in operator and offering sign-out. Empty when sign-in is off. */
export function SessionBar(): ReactElement | null {
  if (!isAuthEnabled()) {
    return null;
  }

  return <SignedInSessionBar />;
}
