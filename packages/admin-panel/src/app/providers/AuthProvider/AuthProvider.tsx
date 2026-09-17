import type { ReactElement, ReactNode } from 'react';
import { MsalProvider } from '@azure/msal-react';
import { isAuthEnabled } from '@/services/auth/auth-config';
import { getMsalInstance } from '@/services/auth/msal-instance';

export interface AuthProviderProps {
  children: ReactNode;
}

/**
 * Supplies the MSAL client to the tree. With sign-in disabled the children are passed through
 * untouched and no Entra configuration is read, so local work needs no tenant.
 */
export function AuthProvider({ children }: AuthProviderProps): ReactElement {
  if (!isAuthEnabled()) {
    return <>{children}</>;
  }

  return <MsalProvider instance={getMsalInstance()}>{children}</MsalProvider>;
}
