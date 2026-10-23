# 0050. The admin panel runs on a data router

- **Status:** Accepted
- **Date:** 2026-10-22
- **Tags:** admin-panel, frontend, routing, search-params
- **Supersedes:** [0018](./0018-nuqs-for-admin-panel-search-params.md) (router placement only)
- **Superseded by:** —

## Decision

The admin panel's router is a data router: `src/app/App.tsx` builds it with `createBrowserRouter`
and renders it through `RouterProvider`, replacing `BrowserRouter` + `<Routes>`. The route table is
unchanged. `NuqsAdapter` moves into the root route's element, wrapping an `<Outlet />`, because it
reads react-router's hooks and a data router gives no context above `RouterProvider`. The router is
created inside a component rendered by `AuthGate` (`useState(() => createBrowserRouter(routes))`),
not at module load, so it reads the URL once a sign-in redirect has settled.

A page may now block navigation with `useBlocker`. The draft editor's `UnsavedChangesGuard` is the
first: with unsaved edits, leaving for another page or another `?version=` opens a "Leave without
saving?" dialog. A tab or step change stays on the draft and is not blocked, and neither is a
navigation started by the editor's own write (a save that moves the draft, a delete), detected
because that mutation is still pending when it navigates. A reload or tab close gets the browser's
own `beforeunload` prompt.

A spec rendering a page that calls `useBlocker` builds its router with `createBrowserRouter` too,
with `NuqsAdapter` in the root route and a `router.dispose()` in `afterEach`. Other specs keep
`BrowserRouter`.

> **Amends [0018](./0018-nuqs-for-admin-panel-search-params.md):** its "mounted inside
> `src/app/App.tsx`, wrapping `<Routes>` below `BrowserRouter`" is replaced by the root route
> element above. Its reason stands: the adapter needs router context and `AppProviders` has none.
> Its spec rule stands too: `createBrowserRouter` still drives `window.history`, so a spec still
> seeds the URL with one `replaceState` and nuqs and react-router share one history.

## Context

Unsaved draft edits were lost without warning on any navigation: the side nav, the version
select, the breadcrumb, a reload. React Router's navigation blocking (`useBlocker`) works only
under a data router and throws under `BrowserRouter`.

## Alternatives

| Option                                                     | Why not                                                                                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep `BrowserRouter`, intercept link clicks and the select | Misses the browser Back button and any navigation the guard does not know about; every new link would need wiring into the guard               |
| `beforeunload` only                                        | Covers reload and tab close, not in-app navigation, which is how edits were actually lost                                                      |
| Create the router at module load                           | It would read the URL before `AuthGate` has finished a sign-in redirect                                                                        |
| Block on `dirty && !busy` from the last render             | A write that resolves before its pending render commits navigates with `busy` still false, so the editor's own save-and-move opened the dialog |

## Consequences

Any future router-context provider goes in the root route element beside `NuqsAdapter`, not around
`RouterProvider`. A data router supports one active blocker at a time, so a second page-level guard
cannot be mounted alongside the draft editor's.

The guard counts any pending mutation as the editor's own write, so a navigation made while an
unrelated mutation is in flight passes unasked. Today only the editor's writes run on that page.

Loaders, actions and lazy routes are now available but unused; adopting any of them is a separate
decision. Reverting is confined to `App.tsx`, the guard and the two specs that build a data router.
