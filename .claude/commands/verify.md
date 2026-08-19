---
description: Run the full CI sequence locally (lint → typecheck → build → test:cov → e2e)
allowed-tools: Bash(pnpm lint:*), Bash(pnpm typecheck:*), Bash(pnpm build:*), Bash(pnpm test:*), Bash(pnpm format:*), Bash(pnpm stack:*), Read, Grep, Glob, Edit
---

The constitution requires that changes pass the same sequence CI runs before they are pushed. Run it
now, in this order, stopping at the first failure:

1. `pnpm format:fix`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm build`
5. `pnpm test:cov`
6. `pnpm test:e2e` — only if the change touches the engine, a connector, a migration, or the compose
   stack. It boots the Docker stack and is slow. Say explicitly when you skip it and why.

Rules:

- Never invoke `jest`, `playwright`, `prettier` or `docker compose` directly — only the root pnpm
  scripts.
- Treat Prettier and ESLint warnings as blocking, exactly like errors.
- On failure: diagnose and fix the cause, then restart the sequence from step 1. Do not weaken a test,
  loosen a lint rule, or add an `eslint-disable` to make it pass — if that seems like the only option,
  stop and explain the trade-off instead.

Report a compact pass/fail line per step, then the first real failure in full if there is one.

$ARGUMENTS
