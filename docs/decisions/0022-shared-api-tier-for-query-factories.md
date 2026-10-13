# 0022. `src/api/<domain>/` joins the admin panel's shared tiers, for query factories

- **Status:** Accepted
- **Date:** 2026-09-22
- **Tags:** admin-panel, frontend, data-fetching
- **Supersedes:** —
- **Superseded by:** [0036](0036-mutation-factories-with-invalidation-meta.md), its "no mutation-options factory" paragraph, its closing open question, its explicit-`TError` rule and its "typed error class" only

## Decision

`src/api/<domain>/` extends [0017](./0017-route-colocated-admin-panel-structure.md)'s list of permitted shared tiers
(`src/components/ui/`, `src/services/`, `src/config/`, `src/constants/`, `src/lib/`).
It holds every engine read and write the panel makes, in the user's own words: "api
folder is only for queries, mutations, types like responses as well as schemas that
validate the contract, nothing else." Display labels, tones and UI predicates stay in
the route, whatever screen decides them.

A domain is one or more fetch or write modules — one per engine resource, each holding
that resource's Zod schema, projected types, typed error class, and its fetch or write
function — plus exactly one `<domain>-queries.ts` factory module holding the
`<domain>Queries` object. The factory stays a separate module from anything it calls
(see Alternatives, "merge each domain's fetch function and factory"). Four domains
exist: `audit`, `onboardings`, `workflows`, `connectors`.

The factory follows tkdodo's query-factory shape, with a hierarchical key so a partial
key invalidates every query beneath it:

```
all()     -> ['audit']
lists()   -> [...all(), 'list']
list()    -> [...lists(), filters]
details() -> [...all(), 'details']
detail()  -> [...details(), id]
```

`onboardingQueries` has all five list/detail entries plus `transitions(id)`, nested
under `detail(id)` rather than sibling to it: its key is
`[...details(), id, 'transitions']`, so invalidating `detail(id).queryKey` alone
already covers both of an onboarding's reads — its summary and its transitions trail —
with the one call. A caller that needed to invalidate the transitions key separately
would either have to know two keys for one resource or over-invalidate with `all()`;
nesting means one key names both. `auditQueries` stops at `list`, since the engine
exposes no `GET /v1/admin/audit/{id}`. `workflowQueries` stops at `details()`, since
nothing yet lists workflow definitions; `connectorQueries` stops at `lists()`, since
nothing yet reads one connector alone. A `queryFn` closes over the `filters` or `id`
its caller passed, rather than reading it back out of `queryKey`, so the key and
the request always derive from the same value — no separate query-key type is needed,
since the key's type is inferred from the `as const` chain. `queryOptions` is called
with both of its first two generics explicit
(`queryOptions<TQueryFnData, TError>`): left to infer, `TError` defaults to `Error`,
which would lose `AuditEventsFetchError` and `AdminOnboardingsFetchError` — which the
hooks expose as the typed `error` of their result contracts — down to an untyped `Error`.

A write is a plain function in its domain's write module —
`patchConnectorSettings`, `deleteConnectorSettings`, `submitOnboardingReview` — called
from `useMutation` in the route's own hook, not from a factory. `@tanstack/react-query`
5.74.0 does not export `mutationOptions`, so the tier holds no mutation-options
factory; only the query side has one. Revisit this once a version that exports the
helper lands.

The tier's origin was 0017's own rule 1 — **two or more consumers moves code out of
`src/app/` into a shared tier** — applied to `GET /v1/admin/audit`'s duplicated read
(see Context). But placement no longer turns on how many routes read a given endpoint:
every engine read and write the panel makes goes in `src/api/<domain>/`, a whole-tier
convention rather than a per-query judgement call. `onboarding-transitions.ts`,
`onboarding-review.ts`, `workflow-definitions.ts` and `connectors.ts` each had exactly
one route consumer when they moved into the tier; rule 1's two-consumer test was where
the tier came from, not what decides membership in it now.

The tier still obeys 0017 in full: no barrel files, and — stated explicitly because it
is the one direction 0017's existing tiers never had to rule out — **the shared tier
must never import from `src/app/`.** A route may import from `src/api/`; only the
reverse is forbidden. Route-level projection (search-param parsing, draft filter
state) stays in the route and feeds the factory already normalized.

## Context

`src/app/audit/api/admin-audit-events.ts` was the only reader of the admin audit
endpoint until the redesigned onboarding details page needed the same trail, scoped to
one onboarding, for its activity log. Rather than import across routes — which 0017
forbids outright, since a route's `api/` folder belongs to that route alone — the
details page grew its own `admin-onboarding-activity.ts`, in its own route-local `api/`
folder: a second Zod schema for the same payload shape, a second error class
(`OnboardingActivityFetchError`), and a second hand-rolled paginated-response reader.
The duplication was intentional under 0017 as it stood — there was nowhere else to put
shared per-resource read logic — but it meant the same endpoint's contract could drift
in two places, and every future consumer would either repeat it a third time or reach
across a route boundary 0017 exists to prevent.

A first attempt at fixing this put a flat `auditEventsQueryOptions` function directly
inside `app/audit/api/admin-audit-events.ts`, keeping the factory route-colocated and
letting the details page import across the route boundary to reach it. It was built,
tested (122 passing tests, clean typecheck) and then reverted at the user's direction:
a factory that only one route can own but a second route must import from is exactly
the cross-route reach 0017's rule 1 already treats as a shared-tier signal, so leaving
it colocated just relocated the duplication problem instead of resolving it.

## Alternatives

| Option                                                              | Why not                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Route-colocated factory, imported across the route boundary         | Built first, then reverted at the user's direction. It technically works, but it means one route's `api/` folder is depended on by another route, which is precisely what 0017's shared-tier rule exists to avoid — the dependency just moves instead of resolving.                                                                                                                                                                                                                                                                        |
| Put the factories in `src/services/api/`                            | That tier holds transport concerns with no per-resource knowledge — `http-client.ts` (the shared axios instance), `describe-request-failure.ts` and `paginated-response.ts` (the generic envelope helper). A per-resource contract (audit's actor/resource vocabulary, an onboarding's projected summary shape) does not belong beside code that has no idea which resource it is transporting.                                                                                                                                            |
| Merge each domain's fetch function and factory into one module      | Tried implicitly by the reverted attempt's shape. A factory whose `queryFn` calls its fetch function _intra-module_ defeats `vi.mock('.../audit-events')`: vitest's module mocking replaces a module's exports only as seen by its _importers_, so a same-module call is invisible to the mock. This broke 20 of `AuditPage`'s 21 tests at once when tried. Keeping the fetch function and the factory as sibling modules keeps the call cross-module, so mocking the fetch module still intercepts it.                                    |
| Route-colocated factory or fetch module for a single-consumer query | Rejected when the transitions, review, workflow-definition and connectors reads and writes moved. Each had exactly one route consumer at the time, so 0017's rule 1 read literally would have left them route-local until a second consumer appeared. That makes placement depend on how many routes happen to read an endpoint today, and means moving the module again the day a second one shows up. The tier is a whole-tier convention instead: every engine read and write goes in `src/api/<domain>/` regardless of consumer count. |

## Consequences

A resource's key hierarchy and its fetch or write function are now declared exactly
once, read by every route that needs them, with the request and the cache key
guaranteed to match because both derive from the same `filters` or `id` value. Adding
a domain to the tier costs a fetch or write module per resource plus one queries
module, never fewer — this is deliberate, for the mocking reason above, and should not
be collapsed later even though it reads as slightly more ceremony than a single module
per domain.

**Migration complete.** `onboardings` gained `onboarding-transitions.ts` and
`onboarding-review.ts`; `workflows` and `connectors` joined as new domains, each with
its own `<domain>-queries.ts` factory, retiring the route-local `CONNECTORS_QUERY_KEY`
and the two `*_QUERY_KEY_PREFIX` constants the details page carried. Every engine read
and write the panel makes now lives in `src/api/<domain>/`; no route builds its own
query key or endpoint constant. The one question this record still leaves open is
where a `mutationOptions`-style factory would live once `@tanstack/react-query` exports
the helper — until then, mutations stay plain write functions called from route-level
`useMutation` calls (see Decision).
