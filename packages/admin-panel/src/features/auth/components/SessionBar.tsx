import type { ReactElement } from 'react';
import { useMsal } from '@azure/msal-react';
import { isAuthEnabled } from '../config/auth-config';
import { Button } from '../../../shared/components/Button/Button';

function SignedInSessionBar(): ReactElement | null {
  const { instance } = useMsal();
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];

  if (!account) {
    return null;
  }

  return (
    <div className="session-bar">
      <span className="session-bar__account">{account.name ?? account.username}</span>
      <Button variant="quiet" size="md" onClick={() => void instance.logoutRedirect()}>
        Sign out
      </Button>
    </div>
  );
}

/** Shows who is signed in and offers sign-out. Renders nothing when sign-in is disabled. */
export function SessionBar(): ReactElement | null {
  if (!isAuthEnabled()) {
    return null;
  }

  return <SignedInSessionBar />;
}
