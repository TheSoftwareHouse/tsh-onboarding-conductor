import type { ReactElement, ReactNode } from 'react';
import { Toaster } from '@/components/ui/Toast/Toaster';
import { AuthProvider } from './AuthProvider/AuthProvider';
import { QueryProvider } from './QueryProvider';

export interface AppProvidersProps {
  children: ReactNode;
}

/** Supplies the toast region, the React Query client and, under it, the auth mount that guards its cache. */
export function AppProviders({ children }: AppProvidersProps): ReactElement {
  return (
    <Toaster>
      <QueryProvider>
        <AuthProvider>{children}</AuthProvider>
      </QueryProvider>
    </Toaster>
  );
}
