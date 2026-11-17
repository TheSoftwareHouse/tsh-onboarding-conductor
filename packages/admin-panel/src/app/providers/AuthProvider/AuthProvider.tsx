import type { ReactElement, ReactNode } from 'react';

export interface AuthProviderProps {
  children: ReactNode;
}

/**
 * The better-auth client keeps its session in its own store, so no context provider is needed;
 * the component stays as the mount point the app tree already has.
 */
export function AuthProvider({ children }: AuthProviderProps): ReactElement {
  return <>{children}</>;
}
