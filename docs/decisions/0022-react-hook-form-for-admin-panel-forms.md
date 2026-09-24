# 0022. react-hook-form is the admin panel's form library

- **Status:** Accepted
- **Date:** 2026-09-18
- **Tags:** admin-panel, frontend, forms
- **Supersedes:** —
- **Superseded by:** —

## Decision

`react-hook-form` 7.88.0 is the admin panel's form library, starting with the
Connectors settings cards and covering every form built after it; it does not cover
the filter panels, which stay outside it — see Consequences. Each `ConnectorCard`
owns exactly one `useForm`, so two cards can never share or clobber state: per-card
draft isolation is structural, not bookkept.

`formState.dirtyFields` is a faithful expression of
[0002](./0002-partial-connector-settings-updates.md)'s merge contract — an operator
changes one setting without resubmitting the secrets the API never returns — and is
read for exactly that, and no further, subject to three constraints the library does
not enforce on its own:

1. **Submit is gated on the trimmed changes map, never on `formState.isDirty`.** RHF's
   own dirty check does not trim, so a whitespace-only edit would read as a change.
2. **The save payload is built from the submitted values compared against the form's
   defaults, never from `getValues()`.** A `getValues()` dump would send `password: ''`
   for every untouched stored secret — the one way a save becomes a credential write
   the operator never asked for.
3. **`reset` takes the submitted values, not the refetched connector.**
   `useConnectors.saveSettings` calls `refetch()` without awaiting it, so at the moment
   of success the `connector` prop still holds pre-save data; resetting from it would
   restore stale defaults and re-offer the value the operator just saved. Secrets map
   back to `''` on reset, because a stored secret's box is always empty regardless of
   what was just submitted.

Rules 1 and 2 stay in `connector-settings-form.ts` rather than in the library, because
`dirtyFields` can say _what_ changed but not _whether it may be deleted_ — that needs
each setting's `secret` and `source`, which only that module has.

**No resolver.** `zod` is present in this package for response projection only. Connector
settings validation belongs to the engine (0002's `validate`/`validateMerge`); a
client-side copy would duplicate it and drift. There are no RHF validation rules
either — `required` is displayed as a hint, and the engine stays the sole authority on
whether a save is accepted.

## Context

`ConnectorsPage` held its own hand-rolled form state — `drafts`, `issuesById`,
`pendingReseed`, `seededIds` refs, and a reseed `useEffect` — to give each connector
card the seeded-value comparison 0002's merge contract requires. That effect raced
React Query's structural sharing: clearing an unconfigured connector produced a
payload deeply equal to the previous one, so the refetched list came back as the
_same_ object, the effect never fired, and an operator's typed value sat in a box
whose stored value had just been deleted underneath it.
`clearConnectorSettingsDraft` existed solely to paper over that race. The team needed
a form model where per-card isolation was a property of the structure, not something
an effect had to notice and re-derive on every fetch.

## Alternatives

| Option                                                                       | Why not                                                                                                                                                           |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep the hand-rolled `drafts`/`issuesById`/`pendingReseed`/`seededIds` model | The status quo being replaced — its reseed effect raced React Query's structural sharing and needed a workaround (`clearConnectorSettingsDraft`) to paper over it |
| One shared `useForm` for the whole page instead of one per card              | Would put every card's dirty state and defaults in one bag, so isolation would again have to be bookkept by hand instead of following from the structure          |
| An RHF `zod` resolver validating connector settings client-side              | Duplicates validation the engine already owns and enforces (0002's `validate`/`validateMerge`); the two would drift                                               |
| Build the save payload from `getValues()`                                    | Sends `password: ''` for every untouched stored secret — the exact unintended credential deletion 0002's merge contract exists to prevent                         |

## Consequences

`react-hook-form` is now the default for any new panel form; a future form reaches
for one `useForm` per independently-saveable unit rather than inventing draft state
by hand. The three constraints above do not live in the library and must survive any
future simplification of `connector-settings-form.ts` or `ConnectorCard` — losing rule
2 in particular turns a save into a silent credential wipe.

The filter panels (Onboardings, Logs, Connectors' own `?type=` nav) are explicitly out
of scope: they are URL-committed criteria owned by
[0018](./0018-nuqs-for-admin-panel-search-params.md)'s `nuqs`, not forms with a submit
step, and this decision does not move them onto RHF.

Reversing this for the Connectors cards is cheap today — it is one component's worth
of form state — but grows more expensive with every additional panel form built on
it, since each one would need its own hand-rolled replacement for the isolation RHF
gives structurally.
