import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // This panel refreshes data only through explicit Apply/Reload/Reset actions,
      // so automatic retries and refetch triggers are intentionally disabled.
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
    },
  },
});

export interface QueryProviderProps {
  children: ReactNode;
}

/** Supplies the shared React Query client to the component tree. */
export function QueryProvider({ children }: QueryProviderProps): ReactElement {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
