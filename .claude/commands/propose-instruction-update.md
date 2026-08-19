---
description: Audit the instruction files against the codebase and propose confirmed-only updates
argument-hint: [area to audit, e.g. "packages" or "CI"]
---

Audit the project's instruction files against the actual codebase and propose updates. **Do not edit
any instruction file in this command.** Proposing, not applying, is the whole point: these are
human-governed documents.

Scope: $ARGUMENTS — if that is blank, audit every file listed below.

Files in scope:

- `CLAUDE.md` (root)
- `packages/engine/CLAUDE.md`
- `packages/engine/src/database/migrations/CLAUDE.md`
- `.github/copilot-instructions.md` and `.github/instructions/*.instructions.md` — the Copilot mirror
  of the same rules

For each claim in those files, verify it against a named file in the repo. Check in particular:

- The package list and what each package actually contains, against `pnpm-workspace.yaml` and
  `packages/*`.
- Dependency names and versions, against the root and per-package `package.json` (including the
  `packageManager` pin).
- Top-level scripts, against the root `package.json` `scripts` block.
- The CI sequence, against `.github/workflows/ci.yml` and `bitbucket-pipelines.yml`.
- Compose services, against `docker-compose.yml`.
- Required env vars, against `.env.dist` and `packages/engine/src/config/`.
- Conventions that describe code shape, against the code that is supposed to follow them.

Report as a table: file → section → the stale claim → what is actually true (with the file that proves
it) → **exact replacement text**. Group the Copilot-mirror edits alongside the `CLAUDE.md` edit they
correspond to, so a confirmed change lands in both.

End by asking which proposals to apply. Apply nothing until I say so.
