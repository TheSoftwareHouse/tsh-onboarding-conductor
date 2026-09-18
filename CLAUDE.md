# TSH Onboarding Conductor

A pnpm-workspace monorepo for an onboarding orchestrator: a NestJS engine that runs
configurable onboarding workflows, plus a React admin panel for operating them.

Packages live under `packages/` (and `packages/shared/`). `@tsh/engine` holds the
orchestration logic; `@tsh/admin-panel` is the React + Vite operator UI; `@tsh/docs` is the
Docusaurus documentation site; `@tsh/openapi` holds the engine's generated OpenAPI document and no
source. `@tsh/demo-bff`, `@tsh/demo-web` and
`@tsh/shared` are still placeholders or e2e skeletons — check for source before assuming one is
implemented.

## Environment

Node 24 and pnpm 11 (`.nvmrc` pins `24`; `nvm use`), as `README.md`, `engines` and CI
all state.

Copy `.env` before anything else: `cp .env.dist .env`. `ConfigModule` reads `.env`
only — `.env.dist` is the sample, never a fallback — so a missing `.env` fails at
bootstrap rather than defaulting.

If host port 5432 or 6379 is taken, set `POSTGRES_PORT` / `REDIS_PORT` in `.env`. That
remaps the host side only; inside the Compose network the engine still reaches
`postgres:5432` and `redis:6379`, so those URLs do not change.

## Commands

Always use the root pnpm scripts. Never invoke `docker compose`, `jest`, `tsc` or
`playwright` directly — the scripts wrap them with required setup and teardown.

| Command                                                                             | Does                                                                                                                       |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm bootstrap`                                                                    | Install from the lockfile and set up Husky hooks                                                                           |
| `pnpm lint` / `pnpm lint:fix`                                                       | ESLint across packages                                                                                                     |
| `pnpm typecheck`                                                                    | `tsc --noEmit` across packages                                                                                             |
| `pnpm build`                                                                        | Build all packages                                                                                                         |
| `pnpm test` / `pnpm test:cov`                                                       | Unit tests (co-located `*.spec.ts`)                                                                                        |
| `pnpm test:integration`                                                             | Integration tests                                                                                                          |
| `pnpm test:e2e`                                                                     | Brings the stack up without the worker, runs e2e, always tears it down                                                     |
| `pnpm format:fix`                                                                   | Canonical repo-wide Prettier write                                                                                         |
| `pnpm workflow:validate [path]`                                                     | Validate every workflow the engine loads, or just the paths named, without the stack                                       |
| `pnpm workflow:compile <file> [--report\|--normalized\|--from-untyped]`             | Compile a workflow the way the engine loads it; `--from-untyped` converts a document of untyped steps                      |
| `pnpm skills:validate [path] [--strict]`                                            | Check the skills and rules in `.claude/` against the repository they cite; no model, runs in CI                            |
| `pnpm skills:routing`                                                               | Measure which skill fires for a table of prompts; spends money, never runs in CI                                           |
| `pnpm skills:ablation`                                                              | Run each ablation case with and without its skill and grade the artifact; spends money, never runs in CI                   |
| `pnpm skills:evals [--validate\|--dry-run\|--case <text>\|--runs <n>\|--model <m>]` | Run the skills' golden sets through headless Claude Code and grade them; local only, on the signed-in account, never in CI |
| `pnpm openapi:generate`                                                             | Rewrite the engine's OpenAPI document from its code                                                                        |
| `pnpm docs:dev` / `pnpm docs:build`                                                 | The documentation site, with hot reload / built                                                                            |
| `pnpm stack:up` / `stack:down` / `stack:ps` / `stack:logs`                          | Local Docker stack                                                                                                         |
| `pnpm stack:panel-dev:up` + `pnpm panel:watch`                                      | Stack serving the admin panel from the host's build                                                                        |

`pnpm test:e2e`, `test:mailhog:integration` and every `stack:*` command need Docker
running. `pnpm format` is check-only and covers just two packages — it is not a
repo-wide gate; use `pnpm format:fix`.

Most scripts fan out with `pnpm -r --if-present run <script>`, so a new package only
joins a suite once it defines that script name.

Run `pnpm format:fix` after making changes: the pre-commit hook (Husky + lint-staged)
runs ESLint with `--max-warnings=0` and Prettier `--check`, and blocks the commit on
either.

CI (`.github/workflows/ci.yml`) runs lint → `skills:validate` → typecheck → build →
`test:cov` → e2e → MailHog integration. Changes must pass that sequence.

The model-driven skill checks never run in CI, in any workflow, and never against the
Anthropic API. `skills:evals`, `skills:routing` and `skills:ablation` each drive headless
Claude Code as the machine's signed-in Claude Code account: every credential variable that
would route a run elsewhere — a key, an auth token, a base-URL override, the Bedrock and
Vertex switches — is dropped before the child starts, and `skills:evals` refuses to start
when `CI` or `GITHUB_ACTIONS` is set. Never add a workflow, step or secret that runs them.

Run `skills:evals --case <skill>` after changing a skill under `.claude/skills/` — its
`SKILL.md`, a reference document or its `evals/` — and the whole suite before opening a
pull request. `scripts/skill-evals-reminder.cjs`, wired as the `PostToolUse` and `Stop`
hooks in `.claude/settings.json`, asks for that run from git's own view of the tree, so a
changed skill cannot be forgotten (`.claude/rules/skill-evals.md`). Run `skills:ablation`
when a skill is written, when its rules change substantially, or when `docs/` grows a
section the skill duplicates. It prints its result and stores nothing — redirect the
output if a sweep is worth keeping.

## Conventions

`docs/IMPLEMENTATION.md` is the as-built specification and the starting point for
anyone continuing development. Update it in the same change that adds, changes or
removes a feature — a merged feature missing from it makes the whole document
untrustworthy. `docs/EXTENDING.md` documents the extension points (workflows,
connector adapters, field types, SSO providers) for outside contributors; update it
when one of them changes. `README.md` is a short landing page — reader-facing material belongs in
the documentation site (`packages/docs/docs/guides`, hand-written; the API and fixture pages there
are generated) and developer material in `docs/`, and anything any of them states as a
request/response shape or command output must come from an actual run. `CONTRIBUTING.md` carries the contribution flow
and the checks a change must pass. The project is MIT-licensed, but the GitHub repository is
currently private — `CONTRIBUTING.md`'s and the issue templates' outside-contributor framing
describes an intended future state, not today's.

The engine's HTTP contract is `packages/shared/openapi/engine.openapi.json`, generated from the
controllers' and DTOs' decorators. A change to a route, a DTO or an error code needs
`pnpm openapi:generate` in the same change; `pnpm test` fails while the file is stale. The
decorator conventions load with the engine's controllers and DTOs (`.claude/rules/api-docs.md`).

Per-area conventions live in `.claude/rules/` and load when a matching file is read.
Skills in `.claude/skills/` cover work a rule cannot reach, because a rule fires on
reading a file and a skill on being asked: `creating-workflows` owns authoring the JSON
definitions under `workflows/`, and `creating-engine-bffs` owns building a service
against the engine's public onboarding API. A skill's frontmatter follows the Agent Skills
specification (agentskills.io) — `name`, `description` and the spec's optional keys only — and
its trigger phrases live in `description`, because no other agent reads Claude Code's
`when_to_use`; `pnpm skills:validate` enforces both. A skill's golden set sits beside it
in `evals/` (`evals.json`, `golden/`, `files/`); `pnpm skills:evals --validate` checks it
without a model, and the package `CLAUDE.md` under `packages/skill-evals` says how a case
is written.

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
