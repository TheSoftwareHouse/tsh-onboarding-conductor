# 0046. One product version, bumped by hand, with a changelog line in every pull request

- **Status:** Accepted
- **Date:** 2026-10-15
- **Tags:** release, versioning, ci, changelog
- **Supersedes:** —
- **Superseded by:** —

## Decision

**The monorepo has one product version.** All nine packages and the root `package.json` carry the
same version, and so does `info.version` in `packages/shared/openapi/engine.openapi.json`, which is
generated from the engine's version.

**Every pull request adds its line to `CHANGELOG.md`.** Entries are written by hand under
`## Unreleased`, in Keep a Changelog's Added / Changed / Fixed / Removed groups, one
`Area — What changed` line per change. A CI job (`pnpm changelog:check`) fails a pull request that
leaves `CHANGELOG.md` unchanged.

**A maintainer bumps the version with `pnpm version:bump`, in a pull request of its own.** The script
takes `patch`, `minor`, `major` or an explicit `X.Y.Z` above the current version. It renames
`## Unreleased` to `## X.Y.Z — <date>` and opens a new, empty `## Unreleased`, writes the version
into every `package.json`, and regenerates the OpenAPI document and the documentation site's API
pages. It refuses when `## Unreleased` lists no change. It does not commit, tag or push. While the
version is `0.x`, a breaking change bumps the minor; from `1.0.0`, the major.

**Changesets are removed.** `@changesets/cli`, the `changeset` script and `.changeset/` are gone.

## Context

Changesets versioned packages independently while the panel, engine and shared packages ship as one
product, and kept change notes in separate files until someone ran a versioning step. Bumping and
generating the changelog on every merge from the squash-merge subject was tried on this branch and
dropped: the team wants to decide when a version is cut, and a PR title is too short to be a useful
changelog line.

## Alternatives

- **Bump on every merge from the commit history** (a workflow running a release script on `main`).
  Rejected: every merge became a release, and the changelog was only as good as the PR titles.
- **No version at all, a date-keyed changelog** (as TheSoftwareHouse/copilot-collections does).
  Rejected: the engine publishes an HTTP contract whose `info.version` clients can pin against.
- **Keep changesets.** Rejected: per-package versions no one consumes separately.
- **Bump in every PR.** Rejected: concurrent PRs would conflict on the version files.

## Consequences

- Every pull request, including a dependency bump or a CI tweak, adds a changelog line.
- Concurrent pull requests append to the same `## Unreleased` group and can conflict there; the
  conflict is two added lines, resolved by keeping both.
- Nothing is tagged; a release is the merge of the bump pull request.
- `CHANGELOG.md` is hand-written and formatted by Prettier like any other Markdown file.
- `scripts/` has its own tests, run by `pnpm test:scripts`, which is part of `pnpm test` and
  `pnpm test:cov`.
