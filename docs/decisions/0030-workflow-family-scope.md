# 0030. A workflow family belongs to one scope, recorded on the family row

- **Status:** Accepted
- **Date:** 2026-09-28
- **Tags:** persistence, workflows, authoring, migrations
- **Supersedes:** —
- **Superseded by:** —

## Decision

A workflow family — every revision sharing one document `id` — belongs to exactly one scope,
`built-in`, `fixtures` or `users`, recorded once in `workflows.scope` by the file that first creates
the family; `workflow_versions.scope` is dropped. A file whose `id` belongs to a family loaded from
or stored under another scope fails the boot with `WorkflowScopeConflictError`, which names both
scopes, the offending file and, when the owner was loaded in the same boot, the owning file, and
points at the fork pattern: copy the document under an id of your own and rename its connector
`sourceKey`s, as `workflows/users/eu-b2c-individual-kyc-eea-local.workflow.json` does. Built-in ids
stay the product's; a deployment adapts a shipped flow by forking it, never by revising it from
`users/`. The file loader enforces the rule across the directories it reads and the startup publish
enforces it against the stored family, before any revision is looked at; `pnpm workflow:validate`
mirrors the loader's half. Every read filters through the family's scope, which is how production
hides the `fixtures` families. Migration `0013` is rewritten in place, as 0028 and 0029 rewrote it.

## Context

Scope sat on each version row and the family row carried none, so the only cross-scope rule was the
loader's refusal of an identical `(id, version)` in two directories. A `users/` file could therefore
declare version 3 of the built-in `eu-b2c-individual-kyc-eea`, join its family as a `users`
revision, become what every unpinned start ran in production, take over the family's label, and
collide at boot the day the product shipped its own version 3. Nothing in the code, tests or
documentation ruled the case in or out. The fork pattern already exists — the shipped
`users/*-local` files copy the built-in flow under ids of their own with renamed `sourceKey`s — and
the source-key uniqueness rule is already keyed by family. Under [0029](0029-workflow-label-and-immutable-versions.md)
a stored version is immutable, so scope equality per version was a second home for a fact that
belongs to the family, exactly as `agreements.type` is a property of an agreement family.

## Alternatives

| Option                                                 | Why not                                                                                                                                                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep scope per version and require equality on publish | Two homes for one fact, and a _new_ version from another scope still passes the per-version check; the rule has to be stated about the family                                                                             |
| Allow mixed scopes, newest version wins                | A deployment silently rewrites what a shipped flow does under the id clients already send, and which revisions production sees depends on version order                                                                   |
| Explicit override: a `users` family shadows a built-in | A real feature needing its own contract — two families per `workflowId` in the admin API and audit, in-flight onboardings on the shadowed family, a relaxed source-key rule; forking gives the result with an explicit id |
| Enforce in the database only                           | A trigger cannot name the files involved, and the rule must fail the boot where the author can act on it                                                                                                                  |

## Consequences

A deployment cannot patch a built-in flow in place: it forks it, renames the connector
`sourceKey`s, and points its clients at the new `workflowId`; onboardings already running stay
pinned to the built-in version they started on. `WorkflowVersionConflictError` becomes
definition-only. The loader, the publish and `scripts/validate-workflows.cjs` all gain the rule,
and `checked-in-workflows.spec.ts` fails should a shipped id ever appear in two directories.

On production fixtures never load, so a `users/` file reusing a fixture id creates a `users` family
there and fails on every development database that stored the fixture; such flows are authored
under ids of their own. Existing development and e2e Postgres volumes carry
`workflow_versions.scope` and no `workflows.scope` and must be reset (`pnpm stack:reset`) before
they boot this revision. Reversing the decision is cheap while nothing is deployed: restore the
column on the version row and drop the two checks.
