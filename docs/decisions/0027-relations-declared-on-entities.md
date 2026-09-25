# 0027. Foreign keys declared on entities: relation decorators are the source of truth, migrations only mirror them

- **Status:** Accepted
- **Date:** 2026-09-15
- **Tags:** persistence, typeorm, migrations, database
- **Supersedes:** —
- **Superseded by:** —

## Decision

Every foreign key in the schema is declared by a TypeORM relation decorator on the owning entity,
not by a raw `CONSTRAINT … FOREIGN KEY` clause buried inside a migration's `CREATE TABLE` body. Each
is a `@ManyToOne` carrying `onDelete` paired with a `@JoinColumn` carrying
`foreignKeyConstraintName`, mapped onto the same database column as the scalar key column beside it
(`onboardingId`, `workflowVersionId`, `agreementVersionId`, …) rather than replacing it, so every
repository query, insert and spec that reads or writes the scalar keeps working untouched. The
eight constrained relations are:

| Constraint                                   | Declared on                                  | `ON DELETE` |
| -------------------------------------------- | -------------------------------------------- | ----------- |
| `fk_onboardings_workflow_version`            | `OnboardingEntity.workflowVersion`           | `RESTRICT`  |
| `fk_workflow_versions_workflow`              | `WorkflowVersionEntity.workflow`             | `CASCADE`   |
| `fk_onboarding_documents_onboarding`         | `OnboardingDocumentEntity.onboarding`        | `CASCADE`   |
| `fk_onboarding_agreements_onboarding`        | `OnboardingAgreementEntity.onboarding`       | `CASCADE`   |
| `fk_onboarding_agreements_agreement_version` | `OnboardingAgreementEntity.agreementVersion` | `RESTRICT`  |
| `fk_agreement_versions_agreement`            | `AgreementVersionEntity.agreement`           | `CASCADE`   |
| `fk_agreements_workflow`                     | `AgreementEntity.workflow`                   | `SET NULL`  |
| `fk_agreements_current_version`              | `AgreementEntity.currentVersion`             | `SET NULL`  |

A reference the schema deliberately leaves unconstrained is declared the same way instead of being
a bare `@Column` that says nothing: `@ManyToOne(..., { createForeignKeyConstraints: false })` with
no `onDelete` and no `foreignKeyConstraintName`. `WebhookOutboxEntity.onboarding` is the one such
reference, with a one-line comment stating why it is unenforced: the outbox is an independent
delivery ledger and must not be deleted by an onboarding's lifecycle.

The database still enforces the eight constrained relations — `ON DELETE CASCADE`, `RESTRICT` and
`SET NULL` are Postgres behaviour, not TypeScript behaviour — but the DDL that creates them no
longer lives inside a `CREATE TABLE` body. `0003_create_onboarding_documents.ts`,
`0013_create_workflows.ts` and `0022_create_agreements.ts` each issue standalone
`ALTER TABLE … ADD CONSTRAINT` statements immediately after their `CREATE TABLE`s, every one
preceded by a comment naming the entity property it mirrors; `fk_onboardings_workflow_version` is
added by `0013` rather than by `0002_create_onboardings.ts` because the table it references does
not exist until then. `packages/engine/CLAUDE.md` forbids a migration importing anything that can
later change, so the constraint DDL is still hand-written SQL rather than generated from entity
metadata; `test/foreign-keys.e2e-spec.ts` is what keeps the two from drifting apart, walking
`DataSource.entityMetadatas[].foreignKeys` against `pg_constraint` in both directions and failing
if a decorator and the database ever disagree.

Inverse sides are declared only where a parent's children are bounded by the parent itself:
`OnboardingEntity.documents` and `OnboardingEntity.agreements` are `@OneToMany` collections, and
no other entity carries one.

## Context

_Amended 2026-09-25: the enumerations in this record were rewritten after record
[0028](0028-identity-and-version-tables.md) split `workflows` and `agreements` into identity and
version tables, the incremental migration history was folded into the creating migrations, and the
`connector_applicant_references` table this record once cited was removed altogether. The decision
itself is unchanged._

Before this change a relation was expressed in exactly one file that could not check itself
against the other: the database knew about it as DDL inside a migration, and the entity did not
know about it at all — `OnboardingDocumentEntity.onboardingId` was a bare
`@Column({ type: 'uuid' })`, with nothing in the file saying it pointed at `onboardings.id`, let
alone that deleting the onboarding deleted the document. A reader of the entity files could not
tell an enforced reference from one that was not; both looked like an ordinary scalar column.

The migrations have never run against a deployed environment, which is what made editing migration
history in place safe rather than a schema-drift risk: there is no deployed database whose schema
an edit could diverge from, and no reason to add a migration whose only job is to undo what an
earlier one did. The first use of that freedom under this record was collapsing
`0006_create_client_webhook_outbox.ts`'s foreign key with the `0012` migration that existed only to
drop it again, moving the reasoning `0012` held onto `WebhookOutboxEntity.onboarding`; the same
reasoning later folded the whole incremental history — every `ALTER` between a table's creation and
its final shape — into the creating migrations, leaving the gaps in the numbering
`docs/IMPLEMENTATION.md` describes. A local Compose volume created before the fold is the one place
the incremental set did run, and it is thrown away once (`pnpm stack:reset`) rather than converged.

## Alternatives

| Option                                                                                             | Why not                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generate the migration's constraint DDL from entity metadata at migration time                     | `packages/engine/CLAUDE.md` forbids a migration importing anything that can later change; generated DDL would silently change if the entity metadata it read later changed, defeating a migration's job as a fixed snapshot of the schema at a point in time                                                  |
| Add a converging migration that drops and re-adds the constraints                                  | No migration has ever run against a deployed environment, so there is no deployed schema for a convergence migration to reconcile — it would be pure ceremony                                                                                                                                                 |
| Leave the unenforced reference as a bare, undecorated scalar column                                | Indistinguishable from the exact problem this decision fixes — a reader would still have no way to tell "not yet declared" from "deliberately unenforced"                                                                                                                                                     |
| Add inverse `@OneToMany` collections on every parent, not only the two on `OnboardingEntity`       | `test/smtp.e2e-spec.ts` builds a standalone `DataSource` with `entities: [ConnectorEntity]` alone; an inverse side pointing at an unloaded entity breaks metadata build. A `WorkflowEntity` or `AgreementEntity` collection would invite an accidental full-table load with no reader                         |
| Convert repository and service query code to relation-based loading (`relations: {}`, eager joins) | Out of scope for this record: where a reader needs a parent's fields, the repository selects the joined columns it uses (`OnboardingsRepository.createReadQueryBuilder`) or names the relation it loads (`WorkflowsRepository.findAll`), never eager loading, and every existing query kept working unchanged |

## Consequences

The entity file is now the one place a reader learns that one table references another, for all
nine references in the schema — eight enforced, one deliberately not. `test/foreign-keys.e2e-spec.ts`
makes that an enforced statement rather than a convention nobody checks: it derives its
expectations from `dataSource.entityMetadatas` rather than a hard-coded list, so a relation added
later without a matching migration constraint — or a constraint added without a matching decorator
— fails the suite instead of drifting silently.

No `CREATE TABLE` body in `src/database/migrations/` contains a `FOREIGN KEY` clause; the only
foreign-key DDL in the directory is the eight `ALTER TABLE … ADD CONSTRAINT` statements in `0003`,
`0013` and `0022`. The gaps in the migration sequence are permanent — the convention is to never
renumber past a deletion — and are the visible trace of the fold.

Nothing about behaviour changed when the decorators were introduced: the scalar key columns are
untouched, `ON DELETE CASCADE` still removes an onboarding's documents and agreement links,
`ON DELETE RESTRICT` still refuses to delete an agreement version an onboarding holds or a workflow
version an onboarding runs on, `ON DELETE SET NULL` clears an agreement family's workflow scope or
current-version pointer when what it points at goes, and `client_webhook_outbox` still has no
foreign key. A future contributor adding a table with a foreign key follows the rule written into
`packages/engine/CLAUDE.md`: declare the relation on the entity first, then have the migration's
`ALTER TABLE` mirror its name and `ON DELETE` action exactly.
