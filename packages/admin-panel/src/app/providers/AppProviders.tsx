import type { ReactElement, ReactNode } from 'react';
import { Toaster } from '@/components/ui/Toast/Toaster';
import { AuthProvider } from './AuthProvider/AuthProvider';
import { QueryProvider } from './QueryProvider';

export interface AppProvidersProps {
  children: ReactNode;
}

/** Supplies the application-wide auth client, React Query client and toast region to the tree. */
export function AppProviders({ children }: AppProvidersProps): ReactElement {
  return (
    <AuthProvider>
      <Toaster>
        <QueryProvider>{children}</QueryProvider>
      </Toaster>
    </AuthProvider>
  );
}
