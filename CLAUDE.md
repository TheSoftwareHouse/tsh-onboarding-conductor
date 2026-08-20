# TSH Onboarding Conductor

A pnpm-workspace monorepo for an onboarding orchestrator: a NestJS engine that runs
configurable onboarding workflows, plus a React admin panel for operating them.

Packages live under `packages/` (and `packages/shared/`). `@tsh/engine` holds the
orchestration logic; `@tsh/admin-panel` is the React + Vite operator UI. `@tsh/demo-bff`,
`@tsh/demo-web`, `@tsh/shared` and `@tsh/openapi` are still placeholders or e2e
skeletons — check for source before assuming one is implemented.

## Environment

Node 24 and pnpm 11 (`.nvmrc` pins `24`; `nvm use`). The `README.md` quickstart still
says Node 20.x — that is stale, `engines` and CI both require 24.

Copy `.env` before anything else: `cp .env.dist .env`. `ConfigModule` reads `.env`
only — `.env.dist` is the sample, never a fallback — so a missing `.env` fails at
bootstrap rather than defaulting.

If host port 5432 or 6379 is taken, set `POSTGRES_PORT` / `REDIS_PORT` in `.env`. That
remaps the host side only; inside the Compose network the engine still reaches
`postgres:5432` and `redis:6379`, so those URLs do not change.

## Commands

Always use the root pnpm scripts. Never invoke `docker compose`, `jest`, `tsc` or
`playwright` directly — the scripts wrap them with required setup and teardown.

| Command                                                    | Does                                                |
| ---------------------------------------------------------- | --------------------------------------------------- |
| `pnpm bootstrap`                                           | Install from the lockfile and set up Husky hooks    |
| `pnpm lint` / `pnpm lint:fix`                              | ESLint across packages                              |
| `pnpm typecheck`                                           | `tsc --noEmit` across packages                      |
| `pnpm build`                                               | Build all packages                                  |
| `pnpm test` / `pnpm test:cov`                              | Unit tests (co-located `*.spec.ts`)                 |
| `pnpm test:integration`                                    | Integration tests                                   |
| `pnpm test:e2e`                                            | Brings the stack up, runs e2e, always tears it down |
| `pnpm format:fix`                                          | Canonical repo-wide Prettier write                  |
| `pnpm stack:up` / `stack:down` / `stack:ps` / `stack:logs` | Local Docker stack                                  |

`pnpm test:e2e`, `test:mailhog:integration` and every `stack:*` command need Docker
running. `pnpm format` is check-only and covers just two packages — it is not a
repo-wide gate; use `pnpm format:fix`.

Most scripts fan out with `pnpm -r --if-present run <script>`, so a new package only
joins a suite once it defines that script name.

Run `pnpm format:fix` after making changes: the pre-commit hook (Husky + lint-staged)
runs ESLint with `--max-warnings=0` and Prettier `--check`, and blocks the commit on
either.

CI (`.github/workflows/ci.yml`) runs lint → typecheck → build → `test:cov` → e2e →
MailHog integration. Changes must pass that sequence.

## Conventions

`docs/IMPLEMENTATION.md` is the as-built specification and the starting point for
anyone continuing development. Update it in the same change that adds, changes or
removes a feature — a merged feature missing from it makes the whole document
untrustworthy.

Per-area conventions live in `.claude/rules/` and load when a matching file is read.
Architecture decisions are indexed in `docs/decisions/README.md`. Before changing
persistence, module boundaries or the API surface, read that index and follow only
records with status `Accepted`; other statuses are history, not constraints.

A workspace with real implementation carries its own `CLAUDE.md` beside its code,
with that workspace's architecture, pitfalls and the rules that apply to it. It loads
when Claude reads a file inside that workspace. A workspace still a placeholder (see
above) has none — there is nothing package-specific to say yet beyond this file.

## Keeping context and decisions current

- When the project's structure, conventions, commands or tooling change in a way
  this file or `.claude/rules/` should reflect, update the affected file in the
  same change. With the `tsh-core` plugin installed, invoke
  `/tsh-core:managing-claude-context`; without it, revise by hand and keep this
  file under 200 lines.
- When an important technical decision is made — architecture, technology,
  approach — propose recording it before the work moves on. With the `tsh-core`
  plugin installed, invoke `/tsh-core:managing-decision-records`; without it,
  match the format of the existing records and update the index in
  `docs/decisions/README.md` in the same change.
