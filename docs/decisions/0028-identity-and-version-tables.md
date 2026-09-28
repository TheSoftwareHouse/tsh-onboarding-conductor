# 0028. Identity and version tables: `workflows`/`agreements` split from their revisions, only `agreements` keeps a current pointer

- **Status:** Accepted
- **Date:** 2026-09-18
- **Tags:** persistence, workflows, agreements, typeorm, migrations
- **Supersedes:** —
- **Superseded by:** [0029](0029-workflow-label-and-immutable-versions.md), for the document-name decision only

## Decision

`workflows` and `agreements` each stop being one row per revision and become an identity row with a
version table beneath it. `workflows (workflow_id uuid PK, name UNIQUE)` gets
`workflow_versions (workflow_version_id uuid PK, workflow_id FK, version, scope, status,
definition, UNIQUE (workflow_id, version))`; `agreements (id uuid PK, workflow_id FK NULL, key
UNIQUE, type, current_version_id FK NULL)` gets `agreement_versions (agreement_version_id uuid PK,
agreement_id FK, version, published_at, UNIQUE (agreement_id, version))`. `onboardings` references
its workflow by the single uuid `workflow_version_id` in place of the former
`(workflow_id, workflow_version)` pair, and `onboarding_agreements` is keyed
`(onboarding_id, agreement_version_id)` in place of `(onboarding_id, agreement_id)` pointing at a
row that was itself one version. A version is now a row with its own primary key rather than half
of a composite key, so every reference from an onboarding names one specific version directly.

**Only `agreements` stores a `current_version_id`; `workflows` does not.** The two tables look
identical in shape, but the column would mean two different things on them, and only one of those
meanings is safe to cache. An agreement version is created exactly once, by
`POST /v1/admin/agreements`, which sets `agreements.current_version_id` in the same statement that
inserts the version row — there is no other write path, so the pointer can never disagree with what
was actually published. A workflow revision's `status` (`draft` / `published` / `retired`) is not
created-once: it is edited directly in Postgres, by an operator or the admin UI, entirely outside
the engine's own write paths, and `test/workflows.e2e-spec.ts:68` asserts that flipping it there
takes effect on the very next request rather than the next boot. A `workflows.current_version_id`
column would need something to keep it in step with an edit the engine never sees happen, which
either means polling for drift or accepting a pointer that silently goes stale — precisely the
failure mode decision [0013](0013-versioned-agreements.md) already rejected for agreement acceptance
status. So a workflow's current revision keeps resolving the way it always did: querying
`workflow_versions` for the highest `published` version when unpinned, or the specific version an
in-flight onboarding is pinned to, with `retired` refused either way. No column, no cache, no
staleness.

**The document's `id` became `workflows.name`, the single workflow name; the document's `name` was
deleted rather than kept beside it.** Every workflow document carries two strings today: `id`
(`eu-b2c-individual-kyc-eea`) and `name` (`EU B2C individual KYC — EEA, applicant chooses the
document`). Only `id` is stable across a workflow's revisions — revision 2 of that same workflow
appends `(specialized steps)` to its `name`. A value that changes between revisions cannot identify
the parent identity row, so `id` is the only candidate for the unique column an identity table
needs, and it is also already the value `POST /v1/onboardings` sends and
`GET /v1/admin/workflows/:workflowId` resolves — the HTTP contract's `workflowId`. That leaves the
prose label with nowhere correct to go: copying it onto `workflows` beside `name` would give the
identity row two names as soon as a second revision touched it (which one wins — the one from
revision 1's upsert, or revision 2's?), and leaving it on `workflow_versions` would just move the
same problem down a level with an extra join to reach it. Nothing in the engine or the admin panel
ever read the field. It was deleted from the document contract entirely — the root schema is closed
(`additionalProperties: false`) with `name` required, so this had to be one atomic change: dropped
from `required` and `properties` in both `ddl-schema` root schemas, from `RawWorkflowDefinition` and
`NormalizedWorkflowDefinition`, from all 26 shipped `*.workflow.json` files, and from
`WorkflowDefinitionResponseDto`, whose `workflowId` already carried the one string that survives. A
document that still declares a root `name` is now rejected with `UNKNOWN_PROPERTY` — a breaking
change for any user-authored workflow document, and deliberately so: the alternative was a lenient
path that would have let two identifiers drift again.

## Context

Before this change, `workflows` was one row per `(workflow_id, version)`, and `agreements` was one
row per `(key, version)` — a family was never a row, only ever recoverable by grouping. That made
three things awkward on the agreements side specifically, and the same shape change also motivated
the workflows split: `onboarding_agreements` names its column `agreement_id` while it in fact points
at one version, the acceptance-status view has to `GROUP BY key` to recover the family, and the
lookup that resolves an agreement's latest version scans with `DISTINCT ON` instead of following a
foreign key. Splitting the identity out turns each of those into a plain foreign key or a stored
pointer, at the cost of one more join to reach a version's parent.

The requester's hand-drawn target model named `Agreement.current_version` as a real field but drew
only arrows — relations, not columns — from `Workflow` to its versions. That asymmetry is what this
record explains: it was not an oversight in translating the diagram, it follows from how each
table's revisions actually get created and edited.

This is a greenfield change: no migration in `packages/engine/src/database/migrations/` has ever
run against a deployed database, which is also what made it safe to rewrite `0013_create_workflows`
and `0022_create_agreements` in place — new column layouts, new constraints, same file, same `name`
field — rather than adding forward-fix migrations on top of the old shape ([0027](0027-relations-declared-on-entities.md) decision 3, repeated by decision 6 of the plan this record
comes from).

## Alternatives

| Option                                                                                                             | Why not                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Give `workflows` a `current_version_id` column, mirroring `agreements`                                             | Nothing writes it when a revision's `status` is edited directly in Postgres, which is the only way `draft`/`published`/`retired` ever changes today; the column would either need to be kept in step with a write path the engine cannot observe, or would go stale silently — exactly the failure mode decision 0013 rejected for stored agreement-acceptance status |
| Keep resolving a workflow's current revision by status query, but also cache a pointer for reads                   | A cache with no invalidation path is just a second, sometimes-wrong answer to the same question the query already answers correctly; it would not be faster in any request path that matters, since a workflow lookup already both queries and validates the definition on every call                                                                                 |
| Copy the document's `name` onto `workflows.name` as a display label and keep `id` as a separate identifying column | Produces the exact ambiguity a unique identity column exists to prevent: two revisions can name different labels, so an upsert would have to pick one arbitrarily (first-seen or most-recent) with no clear right answer, and the label was read by nothing                                                                                                           |
| Move the document's `name` down to `workflow_versions` as a per-revision label instead of deleting it              | Keeps a display string nothing consumes, at the cost of a join to reach it from anywhere that might one day want one; if an operator-facing workflow list later wants a label, the right shape is a nullable `label` column on `workflows` — not a second identifier, and not back inside the document                                                                |
| Don't add `agreements.workflow_id` at all until a scoping feature needs it                                         | Adding the column and its foreign key now, while leaving it null, documents the intended relation on the entity where a reader can see it, and needs no later migration to introduce the column itself — only a DTO change to start writing it                                                                                                                        |

## Consequences

Every reference from an onboarding now names one specific version by a single uuid:
`onboardings.workflow_version_id` and `onboarding_agreements.agreement_version_id` replace the
`(workflow_id, workflow_version)` pair and the version-shaped `agreement_id`. `WorkflowRegistryService`
gains a three-method contract — `resolveForStart` (name in, version row and its uuid out),
`getByVersionId` (uuid in, for every in-flight read), and `getById` (name plus optional version, for
the unchanged admin lookup) — so the compiler flags every call site that used to pass a bare
`workflowId`/`workflowVersion` pair rather than letting a still-number-shaped use survive silently.
`AgreementEntity` stops being "one published version"; the engine now passes around
`AgreementVersionEntity` with its `agreement` relation loaded, so `agreement.key` becomes
`agreementVersion.agreement.key`.

The public HTTP contract changes in exactly the one place this record's third decision describes:
`WorkflowDocument`, `CompiledWorkflowDocument` and `WorkflowDefinitionResponseDto` lose their `name`
member. Every other route, DTO field and error code is byte-identical, and `packages/admin-panel` is
untouched because it never read that member — it reads `step.name`, an unrelated field.

A workflow revision set to `retired` directly in Postgres is refused on the next request without a
restart, exactly as before, because nothing about status resolution changed — only where the
identity and the revision live. `agreements.workflow_id` is declared, foreign-keyed, and null on
every row: scoping a family to one workflow is a real need the requester named, but writing to that
column needs a new field on `PublishAgreementRequestDto`, which is a contract change and therefore a
separate task.
