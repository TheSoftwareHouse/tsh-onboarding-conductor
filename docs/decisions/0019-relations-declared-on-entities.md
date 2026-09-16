# 0019. Foreign keys declared on entities: relation decorators are the source of truth, migrations only mirror them

- **Status:** Accepted
- **Date:** 2026-09-15
- **Tags:** persistence, typeorm, migrations, database
- **Supersedes:** —
- **Superseded by:** —

## Decision

Every foreign key in the schema is now declared by a TypeORM relation decorator on the owning
entity, not by a raw `CONSTRAINT … FOREIGN KEY` clause buried inside a migration's `CREATE TABLE`
body. The three live foreign keys — `fk_onboarding_documents_onboarding` (`CASCADE`),
`fk_onboarding_agreements_onboarding` (`CASCADE`) and `fk_onboarding_agreements_agreement`
(`RESTRICT`) — now appear as a `@ManyToOne` carrying `onDelete` paired with a `@JoinColumn`
carrying `foreignKeyConstraintName`, on `OnboardingDocumentEntity.onboarding` and
`OnboardingAgreementEntity.onboarding` / `.agreement`. Each relation maps onto the same database
column as the pre-existing scalar FK column (`onboardingId`, `agreementId`) rather than replacing
it, so every repository query, insert and spec that reads or writes the scalar keeps working
untouched.

A reference the schema deliberately leaves unconstrained is declared the same way instead of being
a bare `@Column` that says nothing: `@ManyToOne(..., { createForeignKeyConstraints: false })` with
no `onDelete` and no `foreignKeyConstraintName`. `WebhookOutboxEntity.onboarding` and
`ConnectorApplicantReferenceEntity.onboarding` / `.connector` all carry this, each with a one-line
comment stating why the reference is unenforced.

The database still enforces the three constrained relations — `ON DELETE CASCADE` and
`ON DELETE RESTRICT` are Postgres behaviour, not TypeScript behaviour — but the DDL that creates
them no longer lives inside a `CREATE TABLE` body. `0003_create_onboarding_documents.ts` and
`0022_create_agreements.ts` now issue a standalone `ALTER TABLE … ADD CONSTRAINT` immediately after
their `CREATE TABLE`, each preceded by a comment naming the entity property it mirrors.
`packages/engine/CLAUDE.md` forbids a migration importing anything that can later change, so the
constraint DDL is still hand-written SQL rather than generated from entity metadata;
`test/foreign-keys.e2e-spec.ts` is what keeps the two from drifting apart, walking
`DataSource.entityMetadatas[].foreignKeys` against `pg_constraint` in both directions and failing
if a decorator and the database ever disagree.

`0006_create_client_webhook_outbox.ts` created `fk_client_webhook_outbox_onboarding`, and
`0012_drop_client_webhook_outbox_onboarding_fk.ts` existed only to drop it again immediately.
Since neither migration had ever run against a real environment, the pair was collapsed rather
than kept as history: the `FOREIGN KEY` clause was deleted from `0006`'s `CREATE TABLE` and `0012`
was deleted outright, leaving a gap at `0012` in the sequence rather than a renumbering. The
reasoning `0012` used to hold — the outbox is an independent delivery ledger and must not be
deleted by an onboarding's lifecycle — moved to a comment on `WebhookOutboxEntity.onboarding` and
to this record, so deleting the migration lost no reasoning. `connector_applicant_references` has
never had a foreign key at all; its two `createForeignKeyConstraints: false` relations record that
plainly instead of leaving the two columns looking like an oversight.

## Context

Before this change a relation was expressed in exactly one file that could not check itself
against the other: the database knew about it as DDL inside a migration, and the entity did not
know about it at all — `OnboardingDocumentEntity.onboardingId` was a bare
`@Column({ type: 'uuid' })`, with nothing in the file saying it pointed at `onboardings.id`, let
alone that deleting the onboarding deleted the document. A reader of the entity files could not
tell the three enforced references from the three that were not; both looked like an ordinary
scalar column.

The migrations have never run against any environment, which is what made editing migration
history in place safe rather than a schema-drift risk: there is no deployed database whose schema
an edit could diverge from, and no reason to add a migration whose only job is to undo what an
earlier one did. That is also why `0012` could be deleted outright instead of left in place as
dead history.

## Alternatives

| Option                                                                                             | Why not                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generate the migration's constraint DDL from entity metadata at migration time                     | `packages/engine/CLAUDE.md` forbids a migration importing anything that can later change; generated DDL would silently change if the entity metadata it read later changed, defeating a migration's job as a fixed snapshot of the schema at a point in time               |
| Add a converging migration that drops and re-adds the three constraints                            | No migration has ever run in any environment, so there is no deployed schema for a convergence migration to reconcile — it would be pure ceremony                                                                                                                          |
| Leave the three unenforced references as bare, undecorated scalar columns                          | Indistinguishable from the exact problem this decision fixes — a reader would still have no way to tell "not yet declared" from "deliberately unenforced"                                                                                                                  |
| Add inverse `@OneToMany` collections for every relation, including `Connector`/`Agreement`         | `test/smtp.e2e-spec.ts` builds a standalone `DataSource` with `entities: [ConnectorEntity]` alone; an inverse side pointing at an unloaded entity breaks metadata build. An `AgreementEntity` inverse collection would invite an accidental full-table load with no reader |
| Convert repository and service query code to relation-based loading (`relations: {}`, eager joins) | Out of scope for this change — zero `relations:` options exist in the package today and the plan keeps it that way, so every existing query keeps working unchanged                                                                                                        |

## Consequences

The entity file is now the one place a reader learns that one table references another, for all
six references in the schema, enforced or not. `test/foreign-keys.e2e-spec.ts` makes that an
enforced statement rather than a convention nobody checks: it derives its expectations from
`dataSource.entityMetadatas` rather than a hard-coded list, so a relation added later without a
matching migration constraint — or a constraint added without a matching decorator — fails the
suite instead of drifting silently.

No `CREATE TABLE` body in `src/database/migrations/` contains a `FOREIGN KEY` clause any more;
the only three that exist in the whole directory are the `ALTER TABLE … ADD CONSTRAINT`
statements in `0003` and `0022`. The `0012` gap in the migration sequence is permanent — the
convention is to never renumber past a deletion — and is the one visible trace of the pair being
collapsed.

Nothing about behaviour changed: the scalar FK columns are untouched, `ON DELETE CASCADE` still
removes an onboarding's documents and agreement links, `ON DELETE RESTRICT` still refuses to
delete an agreement an onboarding holds, and `client_webhook_outbox` still has no foreign key. A
future contributor adding a table with a foreign key follows the rule now written into
`packages/engine/CLAUDE.md`: declare the relation on the entity first, then have the migration's
`ALTER TABLE` mirror its name and `ON DELETE` action exactly.
