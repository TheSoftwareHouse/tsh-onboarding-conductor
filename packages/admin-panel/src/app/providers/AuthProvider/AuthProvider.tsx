import type { ReactElement, ReactNode } from 'react';
import { isAuthEnabled } from '@/services/auth/auth-config';
import { SessionCacheGuard } from './SessionCacheGuard/SessionCacheGuard';

export interface AuthProviderProps {
  children: ReactNode;
}

/**
 * The better-auth client keeps its session in its own store, so no context provider is needed.
 * What this mounts, while sign-in is on, is the guard that keeps the query cache to the session
 * it was fetched for; it sits under `QueryProvider` and above the router, so it outlives every page.
 */
export function AuthProvider({ children }: AuthProviderProps): ReactElement {
  return (
    <>
      {isAuthEnabled() ? <SessionCacheGuard /> : null}
      {children}
    </>
  );
}
