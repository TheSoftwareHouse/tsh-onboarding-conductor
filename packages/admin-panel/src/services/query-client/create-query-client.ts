import { HttpStatusCode } from 'axios';
import { MutationCache, QueryCache, QueryClient, type QueryKey } from '@tanstack/react-query';
import { ApiError } from '@/services/api/api-error';
import type { InvalidationTargets } from './mutation-options';

function resolve(
  targets: InvalidationTargets<unknown, unknown> | undefined,
  data: unknown,
  variables: unknown,
): readonly QueryKey[] {
  if (!targets) return [];
  return typeof targets === 'function' ? targets(data, variables) : targets;
}

export interface QueryClientOptions {
  /** Called once per read or write the engine refused with a 401: the session behind the cache is gone. */
  onUnauthorized?: (client: QueryClient) => void;
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === HttpStatusCode.Unauthorized;
}

/**
 * Builds the app's QueryClient: query defaults, the handler that acts on mutation meta, and the
 * hook a 401 from any read or write reaches.
 */
export function createQueryClient({ onUnauthorized }: QueryClientOptions = {}): QueryClient {
  const handleError = (error: unknown): void => {
    if (onUnauthorized && isUnauthorized(error)) {
      onUnauthorized(client);
    }
  };

  const client: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Data refreshes only on explicit actions; a remount refetches only a query invalidated meanwhile.
        refetchOnMount: (query) => query.state.isInvalidated,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
    queryCache: new QueryCache({ onError: handleError }),
    mutationCache: new MutationCache({
      onError: handleError,
      onSuccess: async (data, variables, _onMutateResult, mutation) => {
        const { awaits, invalidates } = mutation.meta ?? {};
        for (const queryKey of resolve(invalidates, data, variables)) {
          void client.invalidateQueries({ queryKey });
        }
        await Promise.all(
          resolve(awaits, data, variables).map((queryKey) =>
            client.invalidateQueries({ queryKey }),
          ),
        );
      },
    }),
  });
  return client;
}
