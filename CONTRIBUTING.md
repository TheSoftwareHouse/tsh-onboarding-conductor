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
third-party account.

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
   - `.env.dist` if you add a configuration variable — including the comment explaining it.
   - `README.md` only if the change affects how someone gets started or what the project is.
6. **Add a changeset** for user-facing changes: `pnpm changeset`.

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
and blocks the commit on either. CI runs lint → typecheck → build → tests with coverage → end-to-end
→ the MailHog integration suite, and a pull request needs that sequence green.

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
