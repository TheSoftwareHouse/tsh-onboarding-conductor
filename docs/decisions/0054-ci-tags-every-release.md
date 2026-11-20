# 0054. CI tags every release after a release branch merges

- **Status:** Accepted
- **Date:** 2026-11-19
- **Tags:** release, versioning, ci, changelog, tags, github
- **Supersedes:** [0046-manual-versioning.md](./0046-manual-versioning.md)
- **Superseded by:** —

## Decision

**Every release is an annotated `vX.Y.Z` tag and a GitHub Release, created by CI on the merge
commit of a `release/X.Y.Z` pull request when it merges.** A maintainer still decides when to
release; nobody creates a tag by hand.

**Kept from 0046.** One product version covers every `package.json` and the OpenAPI document's
`info.version`. `CHANGELOG.md` is hand-written in Keep a Changelog groups, and every pull request
adds its line under `## Unreleased`. `pnpm version:bump patch|minor|major|X.Y.Z` cuts the version
and never commits, tags or pushes. While the version is `0.x`, a breaking change bumps the minor.

**Only a release branch changes the version.** A branch named exactly `release/X.Y.Z` is the
release branch for `X.Y.Z`; `version:bump` refuses to run on any branch but the one matching the
version it computes, and creates none. CI fails a pull request that changes the version from any
other branch, whose name does not match the new version, whose new version is not above the old
one or has no non-empty `CHANGELOG.md` section, that leaves a line under `## Unreleased`, that changes a file outside the set
`version:bump` writes (the check reads that set from the script), or that is behind `main`. Release
branches are the one exception to the `<type>/<slug>` branch naming.

**A release workflow tags and publishes the release pull request's merge commit.** It runs when a
`release/*` pull request of this repository merges, and by hand with a commit, which must be on
`main` and change the root `package.json` version. It creates the annotated tag `vX.Y.Z`
(`Release X.Y.Z`) on that commit and a GitHub Release titled `X.Y.Z` whose notes are that version's
`CHANGELOG.md` section. Each step creates only what is missing, so a re-run or a manual run finishes
a half-done release; a tag already on another commit fails the run, and the workflow never moves or
deletes a tag. Later publishing steps, the image and the documentation site, are jobs of the same
workflow, because a tag pushed with the workflow's token starts no other workflow.

**GitHub settings enforce who releases and what stays.** Immutable releases are on for the
repository: once a GitHub Release is published, its tag cannot be moved or deleted, its name cannot
be reused, and its assets are locked; its title and notes stay editable. A branch ruleset on
`release/**` lets only the Maintain and Admin roles create release branches. The ruleset on `main`
requires the `changelog` and `release-check` checks and branches up to date before merging, because
a pull request's checks do not re-run when `main` moves. Nothing restricts who creates a `v*` tag:
a ruleset bypass names an app, role or team, never one workflow, so "nobody tags by hand" is a
convention, and a stray tag fails the release run rather than being overwritten.

**Released changelog sections stay editable.** A pull request may correct an older section; the
tag keeps the text as released, and the GitHub Release keeps the notes it was published with.

**The past releases are tagged once.** An admin tags `v0.1.0` on `d412111b` (#103, which
introduced versioning), `v0.1.1` on `62fb9a91` (#105) and `v0.1.2` on `b139ed73` (#94); each
commit's `package.json` and changelog agree on that version. Immutable releases are switched on
first and a GitHub Release is published for each tag, because immutability covers only releases
published after the setting is on.

**Out of scope:** publishing the engine image, publishing the documentation site, fixes to older
versions (every release is cut from `main`) and pre-release versions.

## Context

Under 0046 a release was the merge of a bump pull request and nothing was tagged, so no released
version can be checked out: `main` carries unreleased changes, and the documentation describes 0.1,
which nobody can obtain. The repository is public. The rule that a bump goes in a pull request of
its own was not enforced, and 0.1.1 and 0.1.2 were bumped inside feature pull requests (#105, #94).
Pull requests are squash-merged, so a commit on a pull request's branch never appears on `main`.

## Alternatives

| Option                                                                | Why not                                                                                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Keep 0046, no tags                                                    | A documented version stays impossible to obtain                                                                                                  |
| `version:bump` tags the release branch locally                        | The squash merge leaves the tag on a commit `main` never contains; the tag exists before review and CI; every maintainer needs tag rights        |
| A maintainer tags `main` by hand after the merge                      | Forgettable, which is today's gap; repeats a decision already made by merging                                                                    |
| Tag on the push to `main`, before CI                                  | A red commit could be tagged, and a tag never moves                                                                                              |
| Tag the `main` commit CI next passes on (`workflow_run`)              | If that run fails or is superseded in the concurrency queue, the next green feature commit carries the version and gets the tag                  |
| Tag on every merge from commit messages (semantic-release)            | Rejected in 0046: the team decides when to release                                                                                               |
| A long-lived `release` branch that `main` is merged into              | A second branch to keep in step with `main`, for a gate the release pull request already provides                                                |
| Signed tags by a release manager (as Node.js does)                    | Signing pays off with a release team holding keys; this project has neither                                                                      |
| `chore/release-X.Y.Z` branches, matching the naming convention        | `release/**` is a namespace a ruleset can target without catching any other branch                                                               |
| Block edits to released changelog sections                            | No common practice does; Keep a Changelog itself marks yanked releases in place                                                                  |
| Tag rulesets on `v*`: creation by the workflow, no update or deletion | A bypass names an app, role or team, never one workflow, and exempts it from every rule in its ruleset; immutable releases lock the tag natively |

## Consequences

- Any release can be checked out as `git checkout vX.Y.Z` or downloaded from its GitHub Release.
- A release pull request must be rebased onto the latest `main` before it merges. Its diff holds no
  code, so the squashed commit's tree equals the tree its pull request CI tested; the tag does not
  wait for CI on `main`.
- A feature that merges while a release run is failing is never tagged: the release commit comes
  from the release pull request, not from `main`'s head. A failed run is re-run, or, once GitHub no
  longer offers that, run by hand with the release commit.
- Until the release workflow finishes, `main` already carries the new version without its tag.
- A tag is locked only once its GitHub Release is published; a run that fails between the two
  leaves a movable tag until it is re-run.
- Releasing depends on someone holding Maintain or Admin; admins can bypass the rulesets.
- The release workflow needs `contents: write`; `ci.yml` keeps `contents: read`. Being the one
  workflow that can write, it pins its actions to commit SHAs.
- Immutable releases and the rulesets live in GitHub's settings, not in the repository, so an admin
  applies them and they are not reviewed in a pull request.
- A future fix to an older version needs a base other than `main`, and pre-releases need
  `version:bump` and the check to accept `X.Y.Z-rc.N`; both would mean a new record.
- Reversing is cheap: delete the workflow and the check. Tags of published releases stay, because
  immutable releases forbid deleting them.
