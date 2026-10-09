import { MutationCache, QueryClient, type QueryKey } from '@tanstack/react-query';
import type { InvalidationTargets } from './mutation-options';

function resolve(
  targets: InvalidationTargets<unknown, unknown> | undefined,
  data: unknown,
  variables: unknown,
): readonly QueryKey[] {
  if (!targets) return [];
  return typeof targets === 'function' ? targets(data, variables) : targets;
}

/** Builds the app's QueryClient: query defaults plus the handler that acts on mutation meta. */
export function createQueryClient(): QueryClient {
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
    mutationCache: new MutationCache({
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
