# 0052. The admin panel renders read states through one kit

- **Status:** Accepted
- **Date:** 2026-11-03
- **Tags:** admin-panel, frontend, ux
- **Supersedes:** —
- **Superseded by:** —

## Decision

Every read's loading, failure and empty state renders through three shared components in
`src/components/ui/`, never a bare `StatusRegion` line:

- **`Loader`**: a spinner, `block` (32 px, centred in its container) or `inline` (16 px beside a
  visible label). Its label is announced at once, but the spinner fades in only after 150 ms
  (`--animate-loader-reveal`), so a fast load shows nothing. There is no minimum display time.
- **`EmptyState`**: kind `empty` (nothing exists yet) or `noMatch` (filters or search exclude
  everything). It is a `role="status"`.
- **`ErrorState`**: kind `error`, `notFound` or `denied`. It is a `role="alert"`, except `notFound`,
  which is a `role="status"`.

`EmptyState` and `ErrorState` share one private layout, `StateLayout`, in two layouts: `page`
(centred on both axes in the container, `h2` title, 32 px icon) and `section` (a bordered row in
the flow, `h3` title, 20 px icon). There is no tile behind the icon. The block `Loader` and the
`page` layout fill a flex-column container, so the container must stretch to the space it owns.
The `section` layout is only for a part nested inside a page whose other parts stay usable; a state
that fills its whole region, including a workflow's tabs, canvases and draft body, uses `page`.

`LoadFailure` (`src/components/ui/LoadFailure/`) maps a failed read onto an `ErrorState`: a 403
becomes `denied` ("No access to …"), a 404 becomes `notFound` when the caller supplies its copy,
and anything else, a 401 included, becomes `error` ("Unable to load …") with **Retry** when the
caller passes `onRetry`.

Rules that follow:

- One thing announces each state: the Loader's, EmptyState's or ErrorState's role. A list's footer
  (count and pager) and a header's summary line appear only once there are results.
- A table keeps its column headers in every state; `TableResults` takes a `state` that renders
  under them in place of the rows and the footer.
- Headers, tabs and filters stay on screen while a page loads; the filters are disabled.
- Data fetched together loads as one Loader. Only a part fetched separately, such as the activity
  log or a workflow version's tab content, has its own loading and failure, as a `section` only when the rest of the page stays usable.
- A mutation's failure stays a toast, outside the kit.

## Context

Each page drew its own states: a `StatusRegion` line for loading, `TableEmptyRow` inside a table,
a private `Failure` component in workflow details, and no Retry anywhere else. The same condition
read differently on every page, and a failed list or details read offered no way to try again.

## Alternatives

| Option                                              | Why not                                                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Skeleton loading                                    | Every page would need a skeleton per layout; kept as a reference on the design canvas only                                      |
| A compact one-line empty row                        | Two empty-state shapes to keep consistent; the `page` layout under the column headers serves tables as well                     |
| One `StateMessage` component with every kind        | Empty and error differ in meaning and live-region role; two components over one layout keep each call site's props honest       |
| A session-expired modal and a "Sign in again" state | The panel sits behind SSO and MSAL redirects an interaction-required error itself; an engine 401 renders as the generic `error` |
| A stale-data banner                                 | Reads do not refetch on their own (`retry: false`, no focus refetch), so there is no background state to announce               |

## Consequences

A new page renders its reads through `Loader`, `EmptyState`, `ErrorState` and `LoadFailure`, and
puts a table's states in `TableResults`'s `state`. The code-splitting work reuses `Loader` and
`ErrorState` for chunk and crash states instead of its own spinner and messages.

A page's container chain must stretch (`flex-1`, `min-h-0`) for the centred states to centre. A 401
has no state of its own: it shows `Unable to load …` with the engine's message, until the panel
handles sign-out. A refetch that clears rows shows the Loader again, because the pages' phase
models are unchanged.
