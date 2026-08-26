# 0002. Connector settings are edited one key at a time through `PATCH`

- **Status:** Accepted
- **Date:** 2026-08-26
- **Tags:** connectors, credentials, api
- **Supersedes:** —
- **Superseded by:** —

## Decision

`PATCH /v1/admin/connectors/:connectorId` merges a fragment into a connector's stored
settings: a string value overwrites that key, `null` deletes it, and **a key absent from
the body is left exactly as stored**. `PUT` keeps its wholesale meaning unchanged, so the
verb alone says which semantics apply. An empty `settings` object is refused with `400`
rather than treated as a no-op, because a request asking for no change is a client bug and
not something worth an audit row.

Validation is split by what each rule can honestly judge. An undeclared key, a non-string
or empty value, and a field's `pattern` are checked against the **submitted** fragment.
The required-key rule and the `smtp` username/password pairing are checked against the
**merged** result, so a fragment that looks harmless on its own cannot leave a connector in
a state the wholesale path would have refused. `would_be_dropped` is never raised here:
nothing is dropped implicitly.

The panel writes only through `PATCH`. A blank secret box means "keep the stored value"
rather than "delete it", clearing a non-secret box that held a stored value is an explicit
deletion, and Save is enabled as soon as one field differs from what it was seeded with.

This record builds on [0001](./0001-runtime-connector-credentials.md) and does not revisit
it: the database is still the only source, settings are still plaintext JSON, and the store
is the `connectors` table — renamed from `connector_settings`, and re-keyed from
`connector_type` to `id` plus a capability `type`, after 0001 was written.

## Context

0001 shipped a wholesale-only write surface. Because a stored secret's value is never
returned by the API — the property 0001 exists to protect — the panel could not resubmit
one it did not hold. Changing a single non-secret field therefore forced the operator to
re-enter every secret on the connector from their own records, or to accept that saving
would drop them. That is a direct and unavoidable consequence of combining "never return a
secret" with "the body replaces the map wholesale", and no amount of panel work removes it:
the missing capability is on the API.

## Alternatives

| Option                                                                    | Why not                                                                                                                                                |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Keep `PUT` only and have the panel resubmit every stored secret           | Impossible by construction — the engine never returns a stored secret's value, which is the guarantee 0001 was built to give                           |
| Return masked or truncated secret values so the panel can round-trip them | Reintroduces the value into every API response and every browser tab in some form, trading the guarantee away to solve an ergonomics problem           |
| A `?merge=true` flag on `PUT`                                             | Puts two opposed semantics behind one verb, so a reader must find the query string to know whether an omitted key survives; `PATCH` already means this |
| Per-key routes (`PUT /:connectorId/settings/:key`)                        | Cannot express the cross-field rules — the `smtp` pairing and the required-key check both need the whole merged map in one request                     |
| Treat an empty `settings` object as a no-op success                       | Hides a client bug and writes an audit row naming no keys, for a request that changed nothing                                                          |

## Consequences

**There are now two write paths whose validation must stay in step.** `validate` and
`validateMerge` differ only in what an absence and a `null` mean; every other rule is shared
through `isDeclaredOrAllowed`, `validateValue`, `checkRequiredKeys` and
`validateSmtpPairing`. A rule added to one path and not the other is the failure mode to
watch for, and it is why those helpers are shared rather than duplicated.

An operator can change one field without holding the connector's other credentials, which
was the point. The cost is that the panel's card is no longer a statement of the
connector's complete desired state — it is a form describing a change — so the draft has to
remember each field's seeded value to tell "edited back to the same text" from "never
touched". `buildConnectorSettingsChanges` is where that comparison lives.

A declared secret field cannot be individually deleted from the panel: its box is always
empty, so emptying it is indistinguishable from never touching it. Deleting one means
`Clear` (`DELETE`, wiping the connector) or a direct `PATCH` with `null`. No connector
shipped today is affected — every declared secret is either required, or `smtp`'s password,
whose only sensible removal is clearing both halves of the pair.

`PUT` remains, fully validated and tested, with no caller inside this repository. That is
deliberate: it is the wholesale verb for an integrator who wants to state a connector's
complete settings in one request, and removing it would leave `PATCH` as the only way to
express "make the stored map exactly this".
