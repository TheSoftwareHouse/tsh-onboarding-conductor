# 0023. Required connector settings are enforced client-side only when unset

- **Status:** Accepted
- **Date:** 2026-09-18
- **Tags:** admin-panel, frontend, forms, connectors
- **Supersedes:** —
- **Superseded by:** —

## Decision

A connector setting declared `required` is enforced client-side only when that
setting's `source` is `unset`; a required setting whose `source` is already `stored`
is exempt from client-side enforcement. This narrows one consequence of
[0022](./0022-react-hook-form-for-admin-panel-forms.md), which recorded "no RHF
validation rules — `required` is displayed as a hint, and the engine stays the sole
authority on whether a save is accepted." The engine remains the sole authority over
the merged result and over pairing rules; this decision does not give the panel any
opinion on `missing_pairing` — see Consequences.

The rule trims: a value counts as present when `value.trim().length > 0`, not merely
non-empty, because `buildConnectorSettingsChanges` trims before building the save
payload — a whitespace-only value would be omitted from the request and rejected by
the engine regardless, so a bare `required: true` check would pass client-side and
still fail on submit. The rejection message is taken verbatim from
`describeConnectorSettingsIssue('missing_required_key')` — the engine's own sentence
— so a pre-flight refusal reads identically to a post-flight one.

Declaration stays separate from enforcement. `isRequired` on the shared
`TextFormField` and `SecretFormField` renders the required badge and sets
`aria-required`, unconditionally, on every required field. A separate `rules` prop
carries the enforcement described above and is wired only when `source === 'unset'`.
That separation is what lets Connectors declare a field required for every setting
while enforcing it only for the settings the panel can actually judge.

## Context

[0002](./0002-partial-connector-settings-updates.md) has the engine check the
required-key rule against the **merged** result, not the submitted fragment, and the
engine never returns a stored secret's value — a stored secret's box in the panel is
therefore always empty, regardless of whether the connector is fully configured. An
unconditional client-side `required` rule cannot tell "never configured" from
"configured, box empty because secrets are never echoed back", and would refuse to
let an operator edit one unrelated field of an already-configured connector, reporting
a stored credential as missing. That is exactly the edit 0002 exists to allow, so the
rule can only fire when `source === 'unset'`, where an empty box genuinely means
nothing is stored.

## Alternatives

| Option                                                             | Why not                                                                                                                                   |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Leave the engine solely authoritative, as 0022 originally recorded | An operator only discovers a missing required key after a round trip to the server, on every submit                                       |
| Enforce `required` unconditionally, regardless of `source`         | Blocks editing one field of an already-configured connector by treating a stored secret's always-empty box as a missing value             |
| A full `zod` resolver mirroring each adapter's `settingsSchema`    | Needs the engine to expose that schema, including cross-field pairings, and creates a second contract that has to be kept in sync with it |

## Consequences

Missing required keys with `source: 'unset'` are now caught before submission,
using the engine's own wording, so the operator sees the same message a moment
earlier. `missing_pairing` violations still surface only as a `400` after
submission, because the one pairing rule (`smtp`'s username/password pair) is a
connector-id conditional in `connector-settings-admin.service.ts` — `settingsSchema`
declares `fields` and nothing cross-field, so no adapter can declare a pairing and
nothing projects one to the panel; using the
engine's exact wording for the one case that is pre-empted is what keeps this
asymmetry invisible to the operator — both paths read as the same authority
speaking, whether before or after submit.

This is the first client-side validation rule in the admin panel. Any future rule
proposed for a form faces the same test this one had to pass: can the client
actually judge the condition, given what the engine withholds — here, a stored
secret's value. A rule that cannot honestly distinguish "unset" from "stored" stays
server-side, as `missing_pairing` still does.
