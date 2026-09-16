# 0017. The admin panel is organized by route, not by feature slice

- **Status:** Accepted
- **Date:** 2026-09-15
- **Tags:** admin-panel, structure, frontend
- **Supersedes:** —
- **Superseded by:** —

## Decision

`packages/admin-panel/src/app/` holds one folder per route, named after its URL
segment (`onboardings`, `onboardings/details`, `audit`, `connectors`), owning every
component, hook, API call, type, util, constant and store that only that route uses.
Code reachable from two or more routes moves out of `src/app/` entirely: shared
components go to `src/components/ui/`, shared logic to `src/services/`, `src/config/`,
`src/constants/` or `src/lib/`. There are no barrel (`index.ts`) files anywhere in the
package.

Four rules decide where a module lands, applied in that order:

1. **Consumers.** One route uses it → it lives in that route's folder. Two or more →
   shared.
2. **Intent overrides consumers, for components.** A component built as a reusable
   primitive stays in `components/ui/` even with a single consumer today; a component
   built for one specific parent nests inside that parent's folder. Without this rule,
   `PageHeader`, `SideNav` and `TshSignet` would all be dragged into the layout folder
   purely because nothing else happens to use them yet.
3. **One file stays flat; more than one gets a folder.** A component that is only its
   `.tsx` stays a flat file; a spec beside it, or children nesting under it, earns a
   folder named after it holding all of them. This holds in every tier, with no
   exemption for `src/components/ui/` and none for grouping folders. The sole thing
   outside the count is a route entry file: a page lives directly in its route folder,
   which is already that page's folder — nesting it would push it below its own route's
   `components/`.
4. **A grouping folder names a family.** Several components that are variants or parts
   of one concept sit under a shared folder — `components/ui/filters/` holds
   `FilterPanel`, the five controls a page renders into it, and the `FilterField`
   wrapper whose `filterControl` variant and `FilterControlProps` interface they share
   and nothing outside the folder imports. The folder groups them; it does not override
   rule 3.

Auth is not a route: `AuthProvider` and `AuthGate` are two halves of one mechanism and
sit together under `providers/AuthProvider/`, with the three non-React auth modules
(`auth-config.ts`, `msal-instance.ts`, `engine-access-token.ts`) in `services/auth/`.

The four page components also dropped their `Admin` prefix (`AdminAuditPage` →
`AuditPage`, and so on); `Admin*` **type** names (`AdminOnboardingSummary`,
`AdminOnboardingFilters`, …) were deliberately left alone, since those mirror
engine-facing contract vocabulary rather than describing a page.

## Context

The package was organized as `src/features/<slice>/` vertical slices, each exporting
through a barrel. The barrel hid how much a page actually reached into a slice, and
the slice boundary had stopped matching the routes: the onboarding slice served two
different pages — the list and its details child — with mostly disjoint code, so
"feature" no longer named a coherent unit to file things under.

## Alternatives

| Option                                             | Why not                                                                                                                                                                                                   |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep `src/features/` vertical slices               | The status quo being replaced. Its barrels hid real reach, and its slice boundaries no longer matched the routes they served.                                                                             |
| A `src/domains/` tier alongside the shared tiers   | A second shared concept with no rule to tell it apart from the first; the existing shared tiers already do the same job.                                                                                  |
| Strict nest-by-usage, without the intent exception | Would file design-system primitives like `PageHeader`, `SideNav` and `TshSignet` under whichever page first happened to use them, rather than where their design intent belongs.                          |
| Next.js's literal `page.tsx` naming                | Four identically-named entry files make stack traces, test output and editor tabs ambiguous; route folders already carry the URL name, so the entry file keeps a descriptive one (`OnboardingsPage.tsx`). |

## Consequences

A component's path now shows its blast radius —
`AuditResults/AuditTable/AuditTableRow/AuditActorCell/` means exactly one consumer at
each level, so changing it can only affect that chain. The cost is symmetric: a
component gaining a second consumer has to move, and deep chains make for long
relative import paths. The import rule answers the second half of that: outside a
route, import with `@/`; inside it, stay relative — `@/app/…` never appears in an
import. Within a shared tier the form is deliberately not fixed: a `components/ui/`
component reaching a sibling may use either the relative path or the alias, and both
appear today. Mandating one would mean rewriting working imports for no gain.

A nested route's shared data layer stays inside the parent route's folder rather than
moving to a shared tier: `/onboardings` and its `/onboardings/:onboardingId` details
child both reach `src/app/onboardings/{api,types,utils,constants}/`, but
`src/app/onboardings/` — not a shared tier — is their common ancestor, so that is where
the four shared modules live. The shared tiers are reserved for code reachable from
outside `src/app/` entirely. `src/services/` is the narrowest of them: it holds only
modules that wrap an external boundary — `services/auth/` wraps MSAL, `services/api/`
wraps axios and the engine, and `services/api/http-client.ts` imports the former from
outside `app/` altogether. Shared code that is not a service goes to `src/config/`,
`src/constants/` or `src/lib/` instead.

Reversing this is moderately expensive: every import path in the package encodes the
current placement, so re-slicing by feature again would touch the same breadth of
files this decision did.
