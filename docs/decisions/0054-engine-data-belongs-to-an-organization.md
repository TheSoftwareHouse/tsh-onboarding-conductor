# 0054. Engine data belongs to a better-auth organization

- **Status:** Accepted
- **Date:** 2026-11-26
- **Tags:** persistence, organizations, multi-tenancy, security, migration
- **Supersedes:** [0053](0053-better-auth-for-admin-authentication.md), its rule that engine data stays global and, for `auth."organization"` alone, its no-entity exemption
- **Superseded by:** —

## Decision

Agreements, workflows and onboardings belong to an organization, and that organization is
better-auth's `auth."organization"` row. There is no separate domain organization table.

1. **One owner column per table.** `agreements`, `workflows` and `onboardings` each get
   `organization_id TEXT NOT NULL`, a foreign key to `auth."organization"("id")` with
   `ON DELETE RESTRICT`. Child tables (`agreement_versions`, `workflow_versions`,
   `onboarding_agreements`, `onboarding_documents` and so on) inherit the owner through their
   parent and get no column of their own.
2. **A migration creates the default organization.** It is a TypeORM migration, not a bootstrap
   service, because the backfill and the `NOT NULL` constraint need the row first. When
   `auth."organization"` is empty, the migration inserts one row named `Default organisation`
   with slug `default`. When rows already exist, which can happen on an installation that ran 0053
   and let a superadmin create organizations, it adopts the oldest by `createdAt` instead. Either
   way, every existing agreement, workflow and onboarding is backfilled to that row before the
   constraint is added.
3. **A parent link exists but is unused.** `auth."organization"` gains a nullable `"parentId"`
   referencing itself. No route, DTO or panel screen reads or writes it.
4. **New rows get the default organization until Story 1.3.** The three write paths
   (`workflows.repository`, `agreements.repository`, `onboardings.repository`) set
   `organization_id` to the default organization, meaning the oldest by `createdAt`. Story 1.3
   replaces that with the operator's current organization. No query filters by organization yet.
5. **`auth."organization"` gets one read-only entity.** 0027 requires every foreign key in `public`
   to be declared by an entity relation (`test/foreign-keys.e2e-spec.ts` enforces it), so the
   three owner columns need a target entity. `OrganizationEntity` maps `auth."organization"` with
   `id`, `name` and `createdAt` and declares no relations of its own. The engine never writes
   through it; better-auth stays the only writer. The other better-auth tables keep 0053's
   no-entity exemption.

Out of scope: connectors and the audit log stay global (audit gets its organization in Story 8.4).
Nothing changes in the admin routes' permissions, which stay as 0053 describes them.

## Context

Story 1.1 of the Organisations epic requires exactly one organization on a fresh start, with a
default name and no parent. It also requires every existing agreement, workflow and onboarding to
belong to it after an upgrade, and no second organization after a restart. Later stories (1.3,
2.x, 10.x) scope data to the current organization, so the data needs an owner first. 0053 had
ruled engine-data tenancy out as "not asked for"; the Organisations epic now asks for it. The
product owner confirmed on 2026-11-26 that better-auth's organization is the organization the epic
describes.

Migrations already run serialized and only in processes that run them (not `MODE=worker-only`), so
creating the row there means two replicas starting together cannot both insert one.

## Alternatives

| Option                                                                      | Why not                                                                                                        |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| A domain `organizations` table in `public`, mapped to the better-auth row   | Two records of one thing that must be kept in sync; the product owner confirmed they are the same organization |
| Seed the default organization from a bootstrap service, like the superadmin | The backfill and `NOT NULL` need the row inside the migration; a service would also race across replicas       |
| Always insert a new default organization on upgrade                         | An installation that already has organizations would end up with two, breaking "exactly one"                   |
| Nullable `organization_id`, tightened in Story 1.3                          | Rows written until then could be left without an owner; there are only three write paths to cover now          |
| `ON DELETE CASCADE` on the owner column                                     | Deleting an organization in the panel would silently erase onboardings and consent evidence                    |
| Exempt cross-schema foreign keys from `foreign-keys.e2e-spec.ts`            | Weakens 0027's enforced rule for exactly the keys most likely to drift on a better-auth upgrade                |
| An owner column on every child table                                        | Redundant with the parent's owner and free to disagree with it                                                 |

## Consequences

Deleting an organization that owns data now fails at the database. The platform pages from 0053
that manage organizations will surface that as an error until a story defines what deleting an
organization means.

Every insert into the three tables must supply `organization_id`. A write path added later that
forgets it fails on the constraint, not silently. Fixtures and integration tests that insert rows
directly need the column too.

"The default organization" means the oldest organization. That holds while the backlog keeps one
organization per installation. Once Story 1.3 resolves the current organization per request, the
default is used only by writes that have no operator, such as built-in workflows loaded at
startup.

A foreign key now crosses from `public` into the `auth` schema, so a future better-auth upgrade
that renames or retypes `organization.id` needs a migration for both schemas.

Reversing this means dropping the three columns and the `parentId` column; the organization rows
themselves stay, because 0053 uses them for permissions.
