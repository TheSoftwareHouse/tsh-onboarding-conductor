import type { ReactElement } from 'react';
import { useMsal } from '@azure/msal-react';
import { Button } from '@/shared/components/Button/Button';
import { Logout } from '@/shared/components/icons';
import { Typography } from '@/shared/components/Typography/Typography';
import { isAuthEnabled } from '../config/auth-config';

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
  const { instance } = useMsal();
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];

  if (!account) {
    return null;
  }

  const name = account.name ?? account.username;

  return (
    <div className="flex flex-none items-center gap-3 border-t border-border-rule px-6 py-4">
      <span
        aria-hidden
        className="flex size-8 flex-none items-center justify-center bg-bg-alt text-caps-tiny text-fg-1"
      >
        {buildInitials(name)}
      </span>
      <Typography variant="body-sm" className="min-w-0 flex-1 truncate text-fg-1">
        {name}
      </Typography>
      <Button
        variant="quiet"
        size="md"
        aria-label="Sign out"
        title="Sign out"
        className="px-2"
        onClick={() => void instance.logoutRedirect()}
      >
        <Logout aria-hidden className="size-5" />
      </Button>
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
