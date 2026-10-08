# 0036. Admin panel writes are mutation factories that declare their cache invalidation in `meta`

- **Status:** Accepted
- **Date:** 2026-10-07
- **Tags:** admin-panel, frontend, data-fetching, mutations
- **Supersedes:** [0022](0022-shared-api-tier-for-query-factories.md), its "no mutation-options factory" paragraph, its closing open question, its explicit-`TError` rule and its "typed error class" only
- **Superseded by:** —

## Decision

`@tanstack/react-query` is pinned at 5.104.1, which exports `mutationOptions`. Every write the panel
makes is declared once as a mutation factory in `src/api/<domain>/<domain>-mutations.ts`:
`workflowMutations`, `connectorMutations`, `onboardingMutations`, `encryptionMutations`. Like a
queries module, it is a sibling of the write module it calls, never merged with it (see 0022). A
route hook spreads a factory into `useMutation` and passes no `mutationFn` of its own.

A factory may declare `meta: { awaits, invalidates }`. Each field is a list of query keys, or a
function `(data, variables) => keys` that returns the whole list, so a branch can return none.
A `MutationCache.onSuccess` handler in `createQueryClient()`
(`src/services/query-client/create-query-client.ts`) reads it:

- It acts on success only. There is no `onError` or `onSettled` meta.
- It calls `invalidateQueries` per key, so a key invalidates by prefix (`lists()` covers every `list(filters)`).
- `invalidates` keys start refetching and are not awaited.
- `awaits` keys are awaited. TanStack runs the cache's `onSuccess` before the mutation's own
  `onSuccess` and before `mutate(…, { onSuccess })`, so an awaited key has refetched before the
  hook toasts or navigates.
- A meta function sees `(data, variables)` and the factory's own params, never the cache.

The app's `QueryClient` is built by `createQueryClient()`, which carries the four query defaults
formerly set in `QueryProvider`. A spec that asserts an invalidation coming from meta builds its
client with `createQueryClient()`; a bare `new QueryClient()` has no handler.

The panel's own `mutationOptions` wrapper (`src/services/query-client/mutation-options.ts`) wraps
TanStack's. TanStack types `meta` once, globally, through `Register.mutationMeta`, which cannot
carry each mutation's `TData` and `TVariables`: a function typed on `WorkflowDraft` is not
assignable to one typed on `unknown` under `strictFunctionTypes`. The wrapper accepts the precise
per-mutation meta and narrows it to the registered `AppMutationMeta<unknown, unknown>` in one
place. `AppMutationMeta` is the composition point for meta sections, which must be type aliases. The wrapper and the client factory are resource-agnostic, so they live in
`src/services/query-client/`, beside `src/services/api/`'s transport helpers, not in `src/api/`.

What stays in the route hooks, because meta only invalidates what `(data, variables)` determines:

- Draft save and delete: `versions(id)` of the old family when `hasOtherVersions` says it remains,
  which reads the cache; `removeQueries` via `removeVersion`, deferred to the editor's unmount
  (`useRemoveVersionOnUnmount`) so the still-mounted editor cannot refetch it into a 404; toasts.
- The review hook's 409 path. Its keys come from `reviewInvalidationKeys`, exported by the factory
  module, so the two lists cannot drift.
- Encryption's `setQueryData` with the write's response. Its four writes declare no meta.
- Every toast, navigation and outcome mapping.

No `mutationKey` is declared; nothing reads mutation state by key.

Every failure is one class, `ApiError` (`src/services/api/api-error.ts`), registered as TanStack's
`defaultError` beside `mutationMeta` in the one `Register` augmentation, `src/react-query-register.ts`. The factories and
`queryOptions` take no generics: `TData` and `TVariables` infer from the annotated
`queryFn` / `mutationFn`, and `TError` resolves to `ApiError`. Each fetch and write function converts
its failures with `toApiError(cause, resourceLabel, describeCode?)`; a 2xx body that fails its Zod
schema becomes `invalidPayloadError(message)`, with `kind: 'invalid-payload'`.

- `status` is the HTTP status; `code` is the body's string `code` for any status, else `null`;
  `body` is the raw response body. Detail properties are never spread onto the error, because
  `WORKFLOW_VERSION_NOT_DRAFT`'s body `status` would collide with the HTTP `status`.
- The message is `describeCode(code)` when that returns a string, otherwise `describeRequestFailure`.
  Drafts pass `describeCode` that returns the code for a known draft code, so an unknown code falls
  back to `describeRequestFailure`. Encryption passes it for 409 and 503 only, mapping through
  `WRITE_ERROR_MESSAGES`.
- A domain with detail properties exports a reader that re-validates `error.body` with its own Zod
  schema: `readDraftError` (with `isDraftErrorCode`) in `workflow-drafts.ts`, and
  `readConnectorSettingsIssues` in `connectors.ts`. Codes stay per-domain lists, not subclasses.
- `useEncryption` and `useConnectors` re-wrap `mutateAsync`'s `unknown` rejection with
  `cause instanceof ApiError`.

## Context

0022 left writes as plain functions called from each route's `useMutation`, because 5.74.0 had no
`mutationOptions`, and left open where such a factory would live once the helper existed. Each hook
then repeated its own `invalidateQueries` calls, and the keys a write owed lived in the hooks, away
from the write and the query keys they name. The draft-authoring work (0034) added three more
writes with branching invalidation. A spec that built a bare `QueryClient` could pass while the
hook it covered invalidated nothing.

The pattern follows tkdodo's "Automatic Query Invalidation after Mutations": a handler on the
client reads the keys a mutation declares. Moving to 5.104.1 supplies the typed `mutationOptions`
helper that 0022 waited for.

## Alternatives

| Option                                                                            | Why not                                                                                                                                                                                              |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stay on 5.74.0 with a homegrown `mutationOptions` helper                          | It reimplements what the library now ships and drifts from it. The upgrade was low-cost: four specs' exact-argument assertions loosened, one row lookup made async.                                  |
| A function per key (`(data, variables) => key`) instead of one for the whole list | Several writes branch: a draft saved in place awaits its own keys, while a moved one invalidates the new location's. A per-key function cannot return "nothing" for one branch; a list can be empty. |
| Meta keys fixed at the factory call, no functions                                 | A create or a moved save names keys from the response (`draft.workflowId`, `draft.version`), which the caller cannot know in advance. The user chose to allow functions.                             |
| Each hook handles its own invalidation (status quo)                               | The keys a write owes sit away from the write, every hook repeats them, and nothing makes a missing invalidation visible. Meta puts them beside the `mutationFn` and one handler carries them out.   |
| Declare `removes` or `onError` meta too                                           | `removeQueries` needs cache state and same-tick ordering with navigation. The 409 invalidation could move, but that adds failure-path semantics for one caller. Both stay imperative for now.        |

## Consequences

`defaultError: ApiError` is a type-level claim, not a runtime guarantee. It holds only because every
fetch and write function converts its failures through `toApiError`; a function that lets an
`AxiosError` escape types it as `ApiError` anyway.

A write's success invalidations are declared once, next to its `mutationFn`, and a factory spec can
assert the resolved keys for given `(data, variables)` without rendering a hook. A hook keeps only
what depends on the cache, the DOM or the router.

The invalidation a write owes is split between two places: meta for what `(data, variables)`
decides, the hook for what the cache decides. A reader must check both. A new write that needs the
cache stays in its hook until `onError`/`onSettled` meta or a declarative `removes` exists.

`useConnectors` no longer calls the query's `refetch()` after a write; the meta invalidates
`lists()`, which refetches the mounted list once, after success only.

An `awaits` key delays the mutation's `onSuccess` by one refetch. Only the in-place draft save uses
it, so its caller settles its text against the refetched document. Any `awaits` added later pays the
same latency before the hook's toast.
