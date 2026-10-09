import type { ApiError } from '@/services/api/api-error';
import type { AppMutationMeta } from '@/services/query-client/mutation-options';

declare module '@tanstack/react-query' {
  interface Register {
    defaultError: ApiError;
    mutationMeta: AppMutationMeta<unknown, unknown>;
  }
}
