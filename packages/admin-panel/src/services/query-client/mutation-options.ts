import {
  mutationOptions as tanstackMutationOptions,
  type DefaultError,
  type QueryKey,
  type UseMutationOptions,
} from '@tanstack/react-query';

export type InvalidationTargets<TData, TVariables> =
  readonly QueryKey[] | ((data: TData, variables: TVariables) => readonly QueryKey[]);

// A type alias, not an interface: the registered mutationMeta must be assignable to Record<string, unknown>.
export type InvalidationMeta<TData, TVariables> = {
  /** Invalidated and awaited before the mutation's own onSuccess runs. */
  awaits?: InvalidationTargets<TData, TVariables>;
  /** Invalidated without waiting. */
  invalidates?: InvalidationTargets<TData, TVariables>;
};

// The one composition point for mutation meta: intersect a new section here, type aliases only.
export type AppMutationMeta<TData, TVariables> = InvalidationMeta<TData, TVariables>;

/** TanStack's mutationOptions with `meta` typed per mutation instead of globally. */
export function mutationOptions<
  TData = unknown,
  TError = DefaultError,
  TVariables = void,
  TContext = unknown,
>(
  options: Omit<UseMutationOptions<TData, TError, TVariables, TContext>, 'meta'> & {
    meta?: AppMutationMeta<TData, TVariables>;
  },
): UseMutationOptions<TData, TError, TVariables, TContext> {
  // The one place the per-mutation meta is narrowed to the registered AppMutationMeta<unknown, unknown>.
  return tanstackMutationOptions<TData, TError, TVariables, TContext>(
    options as UseMutationOptions<TData, TError, TVariables, TContext>,
  );
}
