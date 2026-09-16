import type { ReactElement, ReactNode } from 'react';
import { AuthProvider } from './AuthProvider/AuthProvider';
import { QueryProvider } from './QueryProvider';

export interface AppProvidersProps {
  children: ReactNode;
}

/** Supplies the application-wide auth client and React Query client to the component tree. */
export function AppProviders({ children }: AppProvidersProps): ReactElement {
  return (
    <AuthProvider>
      <QueryProvider>{children}</QueryProvider>
    </AuthProvider>
  );
}
