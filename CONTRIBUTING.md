# Contributing

Thanks for considering a contribution. This document covers how to get set up, what a change has to
pass, and the few conventions that keep the project maintainable.

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Open an issue first for anything substantial.** A bug report or a short proposal saves you from
  building something that turns out to conflict with a decision already taken. Small fixes — a typo,
  a broken link, an obviously wrong branch — can go straight to a pull request.
- **Check the decision records.** [docs/decisions/](docs/decisions/README.md) indexes the
  architectural choices already made. Records with status `Accepted` are constraints; other statuses
  are history. If your change contradicts an accepted record, say so in the issue and argue the case
  — that is a legitimate thing to do, it just needs to be deliberate.
- **Read [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md).** It describes the system as actually
  built, section by section, and is the starting point for anyone continuing development.

## Setting up

Follow the [README quick start](README.md#getting-started): Node 24, pnpm 11, Docker, then
`cp .env.dist .env`, `pnpm bootstrap`, `pnpm stack:up`. A fresh copy of `.env.dist` runs without any
third-party account. A stack you created before the migrations were folded into one in October 2026
cannot boot the current engine — its `migrations` table lists the old migration names — so run
`pnpm stack:reset` once, which throws the local databases away, before `pnpm stack:up`.

Use the root-level commands rather than calling `docker compose`, `jest`, `tsc` or `playwright`
directly — the scripts wrap them with the setup and teardown they need, and running the underlying
tool by hand produces confusing failures.

## Making a change

1. **Branch from `main`**, named `<type>/<slug>` using the
   [Conventional Commits](https://www.conventionalcommits.org/) types: `feat`, `fix`, `chore`,
   `refactor`, `docs`. For example `feat/postal-code-field-type`. The one exception is a release
   branch, `release/X.Y.Z` (see [Versioning](#versioning)).
2. **Keep the change small.** One reviewable slice per pull request. A large branch that touches
   several areas is harder to review than three that don't, and it is more likely to sit unmerged.
3. **Match the surrounding style.** The codebase explains _why_ in comments rather than restating
   what the code does, and prefers reusing an existing helper over introducing a parallel mechanism.
   Per-area conventions live in `.claude/rules/`.
4. **Add tests.** Unit specs sit next to the code as `*.spec.ts`; engine end-to-end specs live in
   `packages/engine/test/`. A bug fix should come with the test that would have caught it.
5. **Update the documentation in the same change:**
   - `docs/IMPLEMENTATION.md` for anything that adds, changes or removes a feature. A merged feature
     missing from it makes the whole document untrustworthy, which is why this is not optional
     cleanup for later.
   - `docs/EXTENDING.md` if you add or change an extension point.
   - `packages/docs/docs/guides/` if the change affects how someone sets up or uses the conductor.
     The site's API reference and fixture pages regenerate themselves from the OpenAPI document and
     the workflow files, so they need no edit.
   - `.env.dist` if you add a configuration variable — including the comment explaining it.
   - `pnpm openapi:generate` if you add or change a route, a DTO or an error code. The committed
     `packages/shared/openapi/engine.openapi.json` must match the code, and `pnpm test` fails when it
     does not. The same command runs after bumping `packages/engine/package.json` to a new minor or
     major: it archives the previous document under `packages/shared/openapi/versions/` before
     regenerating, and that archive is committed with the bump.
   - `README.md` only if the change affects what the project is or where to start.

## Versioning

One product version covers the whole monorepo: the root `package.json`, every workspace's and the
OpenAPI document's `info.version` ([decision 0054](docs/decisions/0054-ci-tags-every-release.md)).
Only a `release/X.Y.Z` pull request changes it, and when that pull request merges, CI tags its merge
commit `vX.Y.Z` and publishes a GitHub Release. Nobody tags by hand.

### Changelog

Every pull request adds a line to `CHANGELOG.md`, under `## Unreleased`, in the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) group it belongs to:

```markdown
## Unreleased

### Added

- Engine — Postal code field type.
```

- **Added** for a new feature, **Changed** for a change to existing behaviour, **Fixed** for a bug
  fix, **Removed** for a removed feature. Create the group if `## Unreleased` does not have it yet.
- One line per change, `Area — What changed`, written for someone who reads the changelog and not
  the code. Mark a breaking change `**Breaking:**` at the start of the line.
- CI fails a pull request that leaves `CHANGELOG.md` unchanged (`pnpm changelog:check` runs the same
  check locally).

### Bump the version

A maintainer cuts a release from an up-to-date `main`, on a branch named for the version:

```bash
git switch main && git pull
git switch -c release/0.2.0
pnpm version:bump minor    # or patch, major, or an explicit version such as 1.0.0
```

`pnpm version:bump` refuses to run on any branch but `release/<the version it computes>`, and it
creates no branch. It turns `## Unreleased` into `## X.Y.Z — <today>` above the entries collected so
far and opens a new, empty `## Unreleased`, writes `X.Y.Z` into every `package.json`, and
regenerates the OpenAPI document and the documentation site's API pages. It refuses when
`## Unreleased` lists no change. It does not commit: review the diff, commit it and open a pull
request titled `chore: release vX.Y.Z`.

- The pull request holds only the files the bump wrote. CI (`pnpm release:check`, which you can run
  locally) fails a pull request that changes the version from any other branch, from a branch whose
  name does not match the new version, with a version not above the current one or without its
  changelog section, with lines left under `## Unreleased` (after a rebase, move them into the
  release's section), with a file outside the bump's set, or behind `main` —
  rebase it onto the latest `main` before it merges. A pull request that does not change the
  version is unaffected.
- When the pull request merges, the release workflow creates the annotated tag `vX.Y.Z` on its merge
  commit and a GitHub Release `X.Y.Z` whose notes are that version's changelog section
  (`pnpm release:notes X.Y.Z` prints them). Features merged meanwhile are never part of the tag.
- If the run fails, re-run it. Once GitHub no longer offers a re-run, run **Release** by hand from
  the Actions tab with the release commit (the squash commit of the release pull request). Either
  way it creates only what is missing; a tag already on another commit fails the run.

While the version is `0.x`, a breaking change bumps the minor; from `1.0.0` on, the major.

### Release setup (admins)

Repository settings and a one-off backfill, none of which live in the repository:

- **Immutable releases:** on (Settings → General → Releases). Once a release is published its tag
  cannot be moved or deleted and its name cannot be reused; its title and notes stay editable. It
  covers only releases published after it is switched on, so switch it on before the backfill.
- **Branch ruleset on `release/**`:** creation restricted to the Maintain and Admin roles.
- **Branch ruleset on `main`:** require the `changelog` and `release-check` status checks and
  "Require branches to be up to date before merging". `pull_request` checks do not re-run when
  `main` advances, so without it a release branch that fell behind can merge on a stale green check.
- **Backfill, once.** The releases made before tagging have no release pull request to trigger the
  workflow, so an admin tags them and publishes their GitHub Releases:

```bash
git tag -a v0.1.0 -m "Release 0.1.0" d412111b
git tag -a v0.1.1 -m "Release 0.1.1" 62fb9a91
git tag -a v0.1.2 -m "Release 0.1.2" b139ed73
git push origin v0.1.0 v0.1.1 v0.1.2
for version in 0.1.0 0.1.1 0.1.2; do
  node scripts/release-notes.cjs "$version" > "/tmp/notes-$version.md"
  gh release create "v$version" --title "$version" --notes-file "/tmp/notes-$version.md" --verify-tag
done
```

Nothing restricts who creates a `v*` tag, because a ruleset cannot single out the release workflow:
never push one by hand outside the backfill. A stray tag fails the release run instead of being
overwritten.

## Checks

Run these before pushing:

```bash
pnpm format:fix     # required — the pre-commit hook rejects unformatted code
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e       # needs Docker; slower, but this is what CI runs
```

The pre-commit hook (Husky + lint-staged) runs ESLint with `--max-warnings=0` and checks formatting,
and blocks the commit on either. CI runs lint → `skills:validate` → typecheck → build → tests with
coverage → end-to-end → the MailHog integration suite, and a pull request needs that sequence green.

A change to a skill under `.claude/skills/` or to its golden set is verified on your own machine,
and nowhere else: run `pnpm skills:evals --case <skill>` for the skill you changed, and
`pnpm skills:evals` before you open the pull request. The golden sets drive headless Claude Code on
your signed-in Claude Code account — no workflow runs them, the command refuses to start in CI, and
any key or gateway setting in your environment is dropped rather than used — so no pipeline will
catch a skill you broke. Put the verdict in the pull request. `pnpm skills:evals --validate` checks that the
golden set is well-formed without a model; it is not a substitute for a run.

## Pull requests

- Title in Conventional Commit form: `feat(engine): postal code field type`. Pull requests are
  squash-merged, so the title becomes the commit message on `main`.
- Describe what changes and why, and how you verified it. If the change is user-visible, say what a
  user will notice.
- Link the issue it closes.
- Expect review comments about naming, placement and whether something simpler would do; they are
  not an objection to the contribution.

## Reporting bugs and security issues

For ordinary bugs, open an issue and use the template — the reproduction steps and the version
matter more than anything else in it.

For anything with security impact, **do not open a public issue.** Report it privately through
GitHub's _Security_ tab on this repository ("Report a vulnerability"), so a fix can be prepared
before the problem is public.
