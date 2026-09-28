# 0031. `@base-ui/react` toasts are the only channel for a mutation's outcome

- **Status:** Accepted
- **Date:** 2026-09-25
- **Tags:** admin-panel, frontend, mutations
- **Supersedes:** —
- **Superseded by:** —

## Decision

`@base-ui/react` 1.8.0 is the admin panel's headless primitive library, starting
with `Toast` and pinned exact the way `react` and `@tanstack/react-query` already
are, with no `components.json`. Everything Base UI wires for the toast — its
manager, its live region, its hover/focus pause — lives in one folder,
`src/components/ui/Toast/`: `toast-manager.ts` holds a module-level
`Toast.createToastManager()` and three helpers, `showSuccessToast(title)`,
`showErrorToast(title, description)` and `showProgressToast(title)`, so a mutation handler outside React (or a
`useMutation` callback) can raise a toast without a hook; `Toaster.tsx` renders
`Toast.Provider` → `Toast.Portal` → `Toast.Viewport` → one `Toast.Root` per tracked
toast, mounted once in `AppProviders` around the whole tree.

**A toast is now the only place a mutation reports its outcome** — a connector
save/clear, a review decision, and the Encryption page's toggle, rotation schedule, add-key
and re-encrypt. The Connectors, details and Encryption page headers no longer carry a
`X settings saved.` / `Unable to save X: …` / `Unable to record the review decision: …`
line — those branches, and the state and props behind them (both pages' `actionMessage`,
`describeDetailsStatus`'s `reviewError` parameter, `resetReviewError`), are removed rather
than kept dead. A `StatusRegion` still reports loading, a fetch error and the page's summary
line (the connector count, or the Encryption page's `summarize(state)`); those, and per-field
connector validation issues, are deliberately **not** toasts — the design's own
"Not a toast" rule — because none of them is a mutation's outcome: a fetch error
persists until the next read, and a field issue belongs beside the field it names,
not in a queue that self-dismisses.

Three kinds, `'success' | 'error' | 'progress'`, each a named-constant timeout
(`TOAST_SUCCESS_TIMEOUT_MS` 5 000, `TOAST_ERROR_TIMEOUT_MS` 10 000, `TOAST_PROGRESS_TIMEOUT_MS`
5 000, the same as success so a progress bar and its settled toast's bar compare); `TOAST_VISIBLE_LIMIT` 3, a fourth toast kept by Base UI but hidden (`data-limited`) until
one clears. **Progress** (`showProgressToast(title)`) is the `tsh-blue-300` tile with a black
`sync` glyph, announced politely like success, for a write the engine accepts and finishes later
in the background — added once such a mutation existed, in Phase 6: the Encryption page's toggle
and re-encrypt. Each of those raises the progress toast the instant the engine accepts the write,
then a second, success toast once the route's own `useSettledChangeToast` hook sees
`isEncryptionChangeInFlight` on the polled state turn `false` for that write — never for a change
the page did not itself start, and not once the page has unmounted. The Encryption page's other
two writes, the automatic-rotation schedule and adding a key, finish synchronously and raise a
plain success toast, the same as a connector save or a review decision.

**Base UI's own hover/focus pause, not the design's restart.** The design states the
restart as a rule, not optional polish — `design-toast-screen.html`: "Hovering holds
the toast; leaving restarts its timer." Base UI 1.8.0 only pauses every open toast's
timer while the viewport is hovered or focused and resumes with the remaining time,
exposed as `data-expanded` on the root. Rebuilding the design's restart on top of
that pause would mean tracking elapsed time ourselves and fighting the manager's own
timer instead of using it; the user's decision was to drop the restart and keep
Base UI's pause/resume as built. The progress bar tracks that same real timer rather
than a separate animation: it pauses whenever Base UI pauses — hover, focus, and the
window losing focus — and a toast that reappears from behind the 3-toast limit
resumes from its remaining time, never a fresh 100% bar. Under
`prefers-reduced-motion` the bar renders as a static full bar with no animation.

**Base UI's native collapsed stack, not the design's flat column.** The user chose
Base UI's own stacking after seeing the built column. Toasts render in the manager's
newest-first order, the newest frontmost at the corner and older ones peeking behind it,
positioned from `--toast-index`, `--toast-offset-y` and `--toast-height`, following Base
UI's hero example. Hover or focus (`data-expanded`) spreads them into a list 8px apart.
The claude.ai design is to be updated to match.

**Announcement is Base UI's own, not a role override.** Task 1.1 set `role`
explicitly to `status` / `alert` on `Toast.Root`, overriding Base UI's `dialog`
default, with `priority` left at its default `'low'` so Base UI's own assertive
announcer would not double-announce an error already marked `alert`. Code review
reversed this: the `role` override is gone, and `showErrorToast` now passes
`priority: 'high'`, so Base UI announces an error once, assertively, through its own
hidden `role="alert"`; a success toast is announced once, politely, through the
viewport's own `Notifications` region. Base UI's built-in announcer is the single
source of truth for both, rather than a role set by hand.

Three smaller deviations from the design, accepted while building Task 1.1: `Toast.Root`
sets `swipeDirection={[]}` (the design has no swipe, and Base UI's default enables
one); `Toast.Title` and `Toast.Description` take Tailwind classes directly rather
than `Typography`, since Base UI owns those elements and `Typography`'s own
polymorphism has nothing to attach to; and the toast card is styled with `tv/cn`,
not through a shared `Toast` design-system component, because Base UI's parts are
already the composable unit.

## Context

Every prior mutation outcome in the panel was inline text in a header `StatusRegion`
— `ConnectorsPage`'s `actionMessage` state set from `handleSave`/`handleClear`, and
the details page's `describeDetailsStatus` reporting `useOnboardingReview`'s
`error`. Both were request-and-forget: nothing bounded how long the message stayed,
nothing distinguished a slow-to-notice success from a failure needing attention, and
a header line competed with the same region's loading and fetch-error text for one
slot. The design specifies a bottom-right toast stack instead — a fixed region, a flat
column with the newest at the bottom, capped at three, a coloured icon tile per kind, a shrinking
progress bar — and the user chose `@base-ui/react`'s own `Toast` primitive to build
it on, over a toast-specific library like `sonner`.

## Alternatives

| Option                                                                 | Why not                                                                                                                                                                                                           |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sonner` or another toast-specific library                             | A second dependency for exactly the behaviour `@base-ui/react`'s own `Toast` already provides, and named inside the Do-NOT-touch list's explicit dependency ban                                                   |
| Rebuild the design's hover-restart behaviour on top of Base UI's pause | The design states the restart as a rule, not optional polish; adding it back needs hand-tracked elapsed time fighting the manager's own timer — the user chose to drop it and keep Base UI's pause/resume instead |
| Keep the inline `StatusRegion` message alongside a toast               | Two channels reporting the same outcome; the user's decision was replacement, not addition, and a duplicated message is one more place the two could disagree                                                     |

## Consequences

`@base-ui/react` is now the admin panel's headless primitive source for anything
past this: a future overlay, menu or dialog reaches for it before reaching for a new
dependency. `showSuccessToast` / `showErrorToast` / `showProgressToast` are the only
sanctioned way to report a mutation's outcome; a new mutation wires its call sites to
them rather than inventing another inline status line. The **progress** variant (the
blue tile, `sync` glyph the design already draws, timed like success) is built rather than staying
deferred: the plan's Improvements held it back until a mutation existed that needed
it, and the Encryption page's toggle and re-encrypt (Phase 6) became exactly that
mutation — each accepted-then-finished-later, each now followed by a settled success
toast once its background change converges. The design's exact hover-restart
behaviour stays unimplemented; revisiting it means replacing Base UI's own
pause/resume with hand-rolled timing, which is worth doing only if an operator
actually needs the bar back at 100% rather than resuming.
