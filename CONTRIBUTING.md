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
third-party account. A stack you created before the migration set was folded in September 2026
cannot boot the current engine — its `migrations` table already lists the folded numbers — so run
`pnpm stack:reset` once, which throws the local databases away, before `pnpm stack:up`.

Use the root-level commands rather than calling `docker compose`, `jest`, `tsc` or `playwright`
directly — the scripts wrap them with the setup and teardown they need, and running the underlying
tool by hand produces confusing failures.

## Making a change

1. **Branch from `main`**, named `<type>/<slug>` using the
   [Conventional Commits](https://www.conventionalcommits.org/) types: `feat`, `fix`, `chore`,
   `refactor`, `docs`. For example `feat/postal-code-field-type`.
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

Nothing to do as an author: every merge into `main` is released automatically
(`.github/workflows/release.yml`, [decision 0046](docs/decisions/0046-commit-driven-versioning.md)).
The squash title becomes the `CHANGELOG.md` line, so keep it a clear Conventional Commit. The
repository squashes with the commit or PR title: for a one-commit PR GitHub proposes that commit's
title, so check the title at merge time. The squash body holds every inner commit's message, so a
`BREAKING CHANGE:` footer in any commit of the PR bumps the minor; edit the message at merge to drop
it. A
`!` after the type (`feat!:`) or a `BREAKING CHANGE:` footer bumps the minor version while the
product is `0.x`, the major from `1.0`; everything else bumps the patch. To jump to a specific
version, set it by hand in every `package.json` in the pull request and it is released as it is.

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
