# 0046. One product version, released on every merge from the commit history

- **Status:** Accepted
- **Date:** 2026-10-13
- **Tags:** release, versioning, ci, changelog
- **Supersedes:** —
- **Superseded by:** —

## Decision

**The monorepo has one product version, and every merge into `main` releases it.** All nine
packages and the root `package.json` carry the same version, and so does `info.version` in
`packages/shared/openapi/engine.openapi.json`. `.github/workflows/release.yml` runs
`scripts/release.cjs` on every push to `main`; the script reads the squash-merge subjects since the
newest `v*` tag and bumps:

- **patch** for every merge;
- **minor** for a breaking change (`type!:` subject or a `BREAKING CHANGE:` footer) while the version
  is `0.x`, **major** from `1.0`.

The script writes the version into every version file, prepends the entry to the generated
`CHANGELOG.md`, commits `chore(release): vX.Y.Z [skip ci]` and creates a lightweight tag `vX.Y.Z`.
It never pushes; the workflow pushes the branch only when the script committed, and pushes the tag
only when the script created it.

**A version set by hand in a PR is released as it is.** When the root version has no tag yet, the
script tags it without bumping; a `CHANGELOG` entry is committed if the PR did not write one. That is how `0.0.1` is baselined (the first run
after the merge tags `v0.0.1`) and how a maintainer jumps to `0.1.0` or `1.0.0`.

**Changesets are removed.** `@changesets/cli`, the `changeset` script and `.changeset/` are gone;
no author action is needed for a release.

## Context

Changesets asked every author to add a file by hand, versioned packages independently while the
panel, engine and shared packages ship as one product, and released nothing until someone ran a
separate versioning step. The PR title is already required to be a Conventional Commit and becomes
the squash commit message, so the history already holds what a changelog needs.

## Alternatives

- **Keep changesets.** Rejected: a manual file per PR that is easy to forget, and per-package
  versions that no one consumes separately.
- **A release PR bot such as release-please.** Rejected: it adds a release PR to merge on top of
  every feature PR; here every merge is a release.
- **Bump in the PR.** Rejected: concurrent PRs would conflict on the version files.

## Consequences

- PR titles must stay conventional and meaningful: the title is the CHANGELOG line, and a missing
  `!` under-bumps a breaking change.
- Release commits bypass CI (`[skip ci]`, and a push made with `GITHUB_TOKEN` triggers no workflow
  run), so a release commit is never tested on its own; it changes version files and `CHANGELOG.md`
  only.
- A rejected push (`main` moved after checkout) fails the run; the next merge's run catches up.
- `CHANGELOG.md` is generated and excluded from Prettier; change the script, not the file.
- `scripts/` has its own tests, run by `pnpm test:scripts`, which is part of `pnpm test` and
  `pnpm test:cov`.
