import type { ReactElement, ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/services/query-client/create-query-client';

const queryClient = createQueryClient();

export interface QueryProviderProps {
  children: ReactNode;
}

/** Supplies the shared React Query client to the component tree. */
export function QueryProvider({ children }: QueryProviderProps): ReactElement {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
