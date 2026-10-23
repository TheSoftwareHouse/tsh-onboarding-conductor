# 0018. nuqs owns the admin panel's search-param state

- **Status:** Accepted
- **Date:** 2026-09-17
- **Tags:** admin-panel, frontend, search-params, validation
- **Supersedes:** —
- **Superseded by:** [0050](./0050-admin-panel-data-router.md) (router placement)

## Decision

`nuqs@^2.10.1` is the single mechanism the admin panel uses to read, write, serialize
and shape-validate URL search params, replacing the hand-written
`src/lib/filter-search-params.ts` and its two per-section readers/builders. Both
filtered sections — Onboardings and Logs — read their committed criteria with
`useQueryStates(parsers, { history: 'replace', shallow: false })`, and build tab links
with a `createSerializer` built from the same parser map, so a committed URL and a tab
link are always produced by the identical code path.

**`shallow: false` is load-bearing, not a preference.** A nuqs commit without it writes
`history.replaceState` and nothing else, which react-router does not observe — so
`useLocation()` goes stale, and `AdminLayout`'s per-section remembered search records the
query string the section had _before_ the commit. Leaving a section and returning to it
via the sidebar then loses the applied filters. Both hooks set it; a future
`useQueryStates` call that anything reads router state after must set it too.

`throttleMs` keeps nuqs' own default, which is browser-dependent (50 ms, or 120–320 ms on
Safari) and exists to stay under Safari's rate limit on `history` writes. An earlier
revision of this change set it to `0` on the reasoning that the `setSearchParams` call it
replaced was synchronous. That bought nothing: only the URL write is throttled, while the
state `useQueryStates` returns — and so the React Query key derived from it — updates on
the spot, so no list, control or status line waits on the throttle. Overriding it would
have given up the rate-limit guard for a delay of at most a few hundred milliseconds on
the URL bar and on `AdminLayout`'s remembered-search bookkeeping.

`NuqsAdapter` is imported from `nuqs/adapters/react-router/v8` (nuqs declares
`react-router: ^5 || ^6 || ^7 || ^8`; the v8 entry currently re-exports v7, and nuqs'
own docs recommend the v8 import so a future divergence is picked up automatically
rather than silently staying on v7 semantics). The adapter consumes react-router's own
hooks, so it is mounted inside `src/app/App.tsx`, wrapping `<Routes>` **below**
`BrowserRouter` — not inside `AppProviders`, which renders above the router and has no
router context to give it.

Validation splits into two layers with one owner each:

- **Per key, at the URL boundary — nuqs.** Each search-param key has its own parser:
  `parseAsStringLiteral` for a closed vocabulary, `parseAsTrimmedString` for free text,
  and a `createParser` each for the page, the two `occurredFrom`/`occurredTo` bounds and
  `workflowVersion`. The first three live in `src/lib/search-params.ts` because both
  sections use them; the two bounds and `workflowVersion` sit beside their own section's
  parser map, since only that section states them. A value a
  parser rejects — an unknown `status`, a non-numeric `page`, a `limit` the panel does
  not offer, an unparseable `datetime-local` string, a `workflowVersion` that is not a
  positive whole number — falls back to that key's default. This is a deliberate
  behaviour change: the panel used to drop every criterion in the set the moment one
  was invalid; it now applies every criterion that is individually valid and falls
  only the bad one back. A hand-edited or stale shared link now degrades gracefully
  instead of resetting the whole filter panel.
- **What no single parser can judge — plain TypeScript, per section.** One genuine
  cross-field rule survives, `occurredFrom <= occurredTo`, since `workflowVersion`'s
  shape moved to its own parser above. It lives in `filter-audit-events.ts` and is read
  two ways: `findOccurredWindowError(filters)` returns the message `AuditPage` shows
  inline and refuses to Apply on, and `toAuditEventQueryFilters(state)` drops a window
  it refuses back to absent, so a URL that states one narrows nothing by it while every
  other criterion still applies — the same per-key fallback the parsers give. Onboardings
  has no cross-field rule at all: `isRequestableWorkflowVersion(value)` is a
  single-control predicate `OnboardingsPage` blocks Apply on, sharing
  `isValidWorkflowVersion` with `workflowVersionParser` so the control and the URL cannot
  disagree about what is requestable. Neither section returns a result union; the pages
  read a message-or-`null` and a boolean.

  Both rules were briefly zod schemas (`.transform` for the trim-and-omit-blanks step,
  `.superRefine` for the cross-field rule); that stage typed its input against an
  already-widened `z.input<...>` and validated almost nothing field-by-field, so it was
  replaced with plain checks typed directly against the section's search-state type. Zod
  is not used anywhere in either section's filter path; it keeps its genuine role
  validating response payloads in `api/*.ts`.

**Absence has one representation, `null`, the whole way through.** A criterion the URL
does not state, states blank, or states in a way its parser refuses reads as `null`, and
stays `null` through `AuditEventQueryFilters` / `AdminOnboardingQueryFilters` into the
`params` object axios is handed. Axios drops a `null` or `undefined` param but serializes
`''` as a bare `key=`, which names a criterion the operator never asked for and the
endpoint does not accept — so blank has to become `null` at the URL boundary, which is
what `parseAsTrimmedString` is for. This replaces the optional keys those two types used
to carry and the hand-written blank-omission that went with them (`createTrimmedAuditEventFilters`,
`createTrimmedAdminOnboardingFilters`, both deleted): nothing downstream filters blanks
out any more, because none reach it. `''` survives only in the `*Filters` types the
controls bind to, where React requires it for a controlled input.

This was first deferred rather than taken, on the grounds that both `*QueryFilters`
objects are React Query keys and changing their shape changes every cache key. It was
taken during this same change once the parsers had already made `null` the natural value
at the boundary and the alternative was converting between two representations by hand at
every step. The cache-key shape did change; it costs nothing, because the panel's query
cache is in-memory (`QueryProvider` installs no persister) and does not outlive a reload.

`occurredPeriod=custom` is still never written to the URL: it stays a derived value,
computed from whether `occurredFrom`/`occurredTo` are present, exactly as before nuqs.
Writing it explicitly was considered and rejected — see Alternatives.

## Context

The panel's URL layer was five hand-written mechanisms: parameter readers
(`readTextParam`, `readEnumParam`, `readPageParam`, `readPageSizeParam`), two
per-section builders, a `useSearchParams` + `setSearchParams(..., { replace: true })`
pair per hook, an "omit blanks and defaults" convention enforced by hand, and
cross-field validation. Extending it for a new criterion meant touching a reader, a
builder and the validator in lockstep, and the "one invalid criterion drops the whole
filter set" behaviour it shipped with was never a deliberate design choice — it was
just what a single `normalize` call over the whole draft produced.

nuqs has a first-class, tested answer for four of those five mechanisms — parsers,
serialization, `useQueryStates`, and `clearOnDefault` for the blank/default rule — and
leaves the fifth, cross-field validation, as something to re-host rather than
reinvent. The draft-then-Apply flow (the fifth original mechanism, not URL logic at
all) is untouched by this decision.

## Alternatives

| Option                                                            | Why not                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep the hand-written `filter-search-params.ts` layer             | The status quo being replaced. A new criterion touched three places in lockstep, and per-key fallback was impossible to add without rewriting the shared `normalize` step into a per-field one, which nuqs already does.                                                                                             |
| Extend the hand-written layer with per-key fallback in place      | Would reinvent what nuqs already tests and ships, for less coverage — nuqs' parsers are exercised against far more edge cases than a bespoke reader would be worth building out.                                                                                                                                     |
| `nuqs/adapters/testing`'s `withNuqsTestingAdapter` for every spec | Considered for hook and page specs, but they assert the committed URL through `useLocation().search`, rendered through `BrowserRouter` so nuqs and react-router share one `window.history`; switching adapters would change what the assertions describe. Kept as an option for a pure-parser spec instead.          |
| Write `occurredPeriod=custom` into the URL                        | Would remove the derivation in `toAuditEventFilters` entirely, at the cost of changing what every existing shared Logs link means. Left as a follow-up, not bundled with this change.                                                                                                                                |
| `throttleMs: 0` on both `useQueryStates` calls                    | Held briefly, on the reasoning that the `setSearchParams` call being replaced was synchronous. Nothing the operator sees waits on the throttle, since only the URL write is throttled and the returned state is not, so the override gave up nuqs' Safari rate-limit guard for no gain. Removed; the default stands. |
| Leave `shallow` at its default too                                | Tested and refused: without `shallow: false` a commit never reaches react-router, so `useLocation()` goes stale and the remembered per-section search regresses. The two options look alike and are not — one is a guard worth keeping, the other breaks a feature.                                                  |

## Consequences

An unrecognized or stale criterion in a shared or hand-edited link now degrades
per-key instead of resetting the whole filter panel — `?workflowVersion=abc&status=active`
applies `status` and falls only `workflowVersion` back to its default. This is a
user-visible behaviour change from before this decision, documented in
`docs/IMPLEMENTATION.md` §12.

Adding a new URL-backed criterion is now one parser map entry plus, if it interacts
with another field, one plain-TypeScript check in that section's query projection —
no separate reader, builder or blank-omission logic to keep in step. A criterion whose
parser yields `null` for blank needs nothing else to stay off the wire, but one that can
yield `''` would be sent as a bare `key=`; new parsers must therefore reject blank the
way `parseAsTrimmedString` does. The adapter's
placement below `BrowserRouter` and outside `AppProviders` is a constraint every
future provider added to the app shell must respect if it needs router context:
`AppProviders` cannot host anything that depends on react-router's hooks.

Page and hook specs that read the committed search state render through
`BrowserRouter`, not `MemoryRouter`: jsdom's `BrowserRouter` shares one
`window.history` with the nuqs adapter, so a spec seeds the URL with one
`window.history.replaceState` call before rendering and a `<Link>` click is
observed by both react-router and nuqs with no bridging code. An earlier version of
this decision reached for `MemoryRouter` plus a spec-local `LocationSync` component
to paper over the two routers' separate histories; that bridge caused a feedback
loop with `shallow: false` that failed `pnpm test:cov` in six runs out of seven and
was deleted once `BrowserRouter` replaced it — no spec in the codebase uses
`LocationSync` today. Specs that render only a tab strip in isolation, asserting
rendered `<Link>` hrefs rather than the committed URL, still use a plain
`MemoryRouter` with no adapter, since they never read nuqs state.
