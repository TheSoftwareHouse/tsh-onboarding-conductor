# 0055. The MVP has exactly one organization

- **Status:** Accepted
- **Date:** 2026-11-27
- **Tags:** organizations, security, admin-panel, configuration
- **Supersedes:** [0053](0053-better-auth-for-admin-authentication.md), its superadmin's ability to create organizations only
- **Superseded by:** —

## Decision

An installation has exactly one organization: the default organization from 0054. No one can
create a second organization, and no one can delete it.

1. **No creation.** better-auth's organization plugin runs with
   `allowUserToCreateOrganization: false`, so `POST /v1/auth/organization/create` answers `403`
   for every user, superadmin included. The admin panel has no create-organization form.
2. **No deletion.** The plugin runs with `disableOrganizationDeletion: true`, so
   `POST /v1/auth/organization/delete` answers `404`. No data is ever removed through an
   organization. The `ON DELETE RESTRICT` keys from 0054 stay as the database-level guard.
3. **The seeded superadmin owns the default organization.** At startup, `SuperadminSeedService`
   makes the superadmin named by `AUTH_SUPERADMIN_EMAIL` an `owner` member of the default
   organization if they are not one already. better-auth only lets a member invite people, and
   the default organization has no members otherwise. The step is idempotent and runs wherever
   the seed runs.

Server-side calls with no session (better-auth's "system action") can still create an
organization. The engine makes none; the e2e helper uses them for role fixtures.

## Context

The product owner set the MVP to one organization, which is never deleted and never takes data
with it (developer, 2026-11-27; the backlog lists "creating further organisations" as out of scope).
0053 let a superadmin create organizations from the panel, and nothing blocked deleting one, so the
rule held only where 0054's `RESTRICT` keys happened to apply, and deletion surfaced as a `500`.

## Alternatives

| Option                                                | Why not                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Rely on `ON DELETE RESTRICT` alone                    | Deleting an organization with no rows succeeds, deleting one with rows answers `500`, and creating a second one stays possible |
| `organizationLimit: 1` per user                       | Limits memberships per user, not organizations per installation                                                                |
| Keep creation for the superadmin only                 | Contradicts the one-organization MVP scope                                                                                     |
| Every superadmin, including later ones, becomes owner | Needs a hook on role changes; the env-seeded superadmin is enough to invite everyone else                                      |
| Superadmin bypass inside better-auth's invite route   | better-auth has no such option; patching the library is not an option                                                          |

## Consequences

A deployment that relied on a superadmin creating organizations loses that ability. Operators are
invited into the default organization by its owner. A superadmin added later through user
management is not a member until invited.

Lifting the rule (more organizations, Story 1.3 and beyond) means turning both options back on and
deciding what deleting an organization that owns data means. That needs a record superseding this
one.
