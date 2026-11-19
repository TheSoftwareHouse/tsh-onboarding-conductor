# 0054. CI tags every release after a release branch merges

- **Status:** Proposed
- **Date:** 2026-11-19
- **Tags:** release, versioning, ci, changelog, tags, github
- **Supersedes:** [0046-manual-versioning.md](./0046-manual-versioning.md)
- **Superseded by:** —

## Decision

**Every release is an annotated `vX.Y.Z` tag and a GitHub Release, created by CI on `main` after
the release pull request merges and CI passes on that commit.** A maintainer still decides when to
release; nobody creates a tag by hand.

**Kept from 0046.** One product version covers every `package.json` and the OpenAPI document's
`info.version`. `CHANGELOG.md` is hand-written in Keep a Changelog groups, and every pull request
adds its line under `## Unreleased`. `pnpm version:bump patch|minor|major|X.Y.Z` cuts the version
and never commits, tags or pushes. While the version is `0.x`, a breaking change bumps the minor.

**Only a release branch changes the version.** A branch named exactly `release/X.Y.Z` is the
release branch for `X.Y.Z`; `version:bump` refuses to run on any branch but the one matching the
version it computes, and creates none. CI fails a pull request that changes the version from any
other branch, whose name does not match the new version, that changes a file outside the set
`version:bump` writes (the check reads that set from the script), or that is behind `main`. Release
branches are the one exception to the `<type>/<slug>` branch naming.

**A release workflow tags and publishes.** It runs when `ci.yml` succeeds on a `main` commit, and
by hand from the Actions tab. When tag `v<root package.json version>` does not exist, it creates it
as an annotated tag `Release X.Y.Z` on that commit and a GitHub Release titled `X.Y.Z` whose notes
are that version's `CHANGELOG.md` section. When the tag exists it does nothing; it never moves or
deletes a tag.

**GitHub rulesets enforce who.** A tag ruleset on `v*` lets only the release workflow create tags
and blocks every update and deletion. A branch ruleset on `release/**` lets only the Maintain and
Admin roles create release branches.

**Released changelog sections stay editable.** A pull request may correct an older section; the
tag keeps the text as released, and the GitHub Release keeps the notes it was published with.

**The past releases are tagged once.** An admin tags `v0.1.0` on `d412111b` (#103, which
introduced versioning), `v0.1.1` on `62fb9a91` (#105) and `v0.1.2` on `b139ed73` (#94); each
commit's `package.json` and changelog agree on that version.

**Out of scope:** publishing the engine image, publishing the documentation site, fixes to older
versions (every release is cut from `main`) and pre-release versions.

## Context

Under 0046 a release was the merge of a bump pull request and nothing was tagged, so no released
version can be checked out: `main` carries unreleased changes, and the documentation describes 0.1,
which nobody can obtain. The repository is public. The rule that a bump goes in a pull request of
its own was not enforced, and 0.1.1 and 0.1.2 were bumped inside feature pull requests (#105, #94).
Pull requests are squash-merged, so a commit on a pull request's branch never appears on `main`.

## Alternatives

| Option                                                         | Why not                                                                                                                                   |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Keep 0046, no tags                                             | A documented version stays impossible to obtain                                                                                           |
| `version:bump` tags the release branch locally                 | The squash merge leaves the tag on a commit `main` never contains; the tag exists before review and CI; every maintainer needs tag rights |
| A maintainer tags `main` by hand after the merge               | Forgettable, which is today's gap; repeats a decision already made by merging                                                             |
| Tag on the push to `main`, before CI                           | A red commit could be tagged, and a tag never moves                                                                                       |
| Tag on every merge from commit messages (semantic-release)     | Rejected in 0046: the team decides when to release                                                                                        |
| A long-lived `release` branch that `main` is merged into       | A second branch to keep in step with `main`, for a gate the release pull request already provides                                         |
| Signed tags by a release manager (as Node.js does)             | Signing pays off with a release team holding keys; this project has neither                                                               |
| `chore/release-X.Y.Z` branches, matching the naming convention | `release/**` is a namespace a ruleset can target without catching any other branch                                                        |
| Block edits to released changelog sections                     | No common practice does; Keep a Changelog itself marks yanked releases in place                                                           |

## Consequences

- Any release can be checked out as `git checkout vX.Y.Z` or downloaded from its GitHub Release.
- A release pull request must be rebased onto the latest `main` before it merges. Its diff holds no
  code, so the squashed commit's tree equals the pull request's, and CI on `main` fails only
  through a flaky test; re-running CI tags it.
- Until the release workflow finishes, `main` already carries the new version without its tag.
- Releasing depends on someone holding Maintain or Admin; admins can bypass the rulesets.
- The release workflow needs `contents: write`; `ci.yml` keeps `contents: read`.
- The rulesets live in GitHub's settings, not in the repository, so an admin applies them and they
  are not reviewed in a pull request.
- A future fix to an older version needs a base other than `main`, and pre-releases need
  `version:bump` and the check to accept `X.Y.Z-rc.N`; both would mean a new record.
- Reversing is cheap: delete the workflow and the check. Tags already published stay, because the
  ruleset forbids deleting them.
