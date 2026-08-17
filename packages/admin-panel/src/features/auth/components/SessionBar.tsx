import type { ReactElement } from 'react';
import { useMsal } from '@azure/msal-react';
import { isAuthEnabled } from '../config/auth-config';

function SignedInSessionBar(): ReactElement | null {
  const { instance } = useMsal();
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];

  if (!account) {
    return null;
  }

  return (
    <div className="session-bar">
      <span className="session-bar__account">{account.name ?? account.username}</span>
      <button type="button" onClick={() => void instance.logoutRedirect()}>
        Sign out
      </button>
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
