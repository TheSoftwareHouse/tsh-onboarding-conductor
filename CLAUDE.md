# CLAUDE.md — project constitution

> **Read this as a hard constraint, not a guideline.** Every rule below binds all work in this
> repository, without exception. Where a rule here conflicts with your general knowledge or with
> external best practices, this file wins. If a rule seems wrong, say so and ask — do not quietly
> route around it.

**Scoped rules live in nested `CLAUDE.md` files** and load automatically when you touch those
directories. Read them before writing code there:

| Scope                                        | File                                                |
| -------------------------------------------- | --------------------------------------------------- |
| `packages/engine/**` (architecture, errors)  | `packages/engine/CLAUDE.md`                         |
| `packages/engine/src/database/migrations/**` | `packages/engine/src/database/migrations/CLAUDE.md` |

# Architecture

This repository is a monorepo managed with pnpm workspaces (`pnpm-workspace.yaml`: `packages/*` and
`packages/shared/*`).

The packages are:

- `packages/engine` (`@tsh/engine`) — NestJS backend, the core orchestrator service and the bulk of
  the business logic. It wires `ConfigModule`, `TypeOrmModule` (Postgres) and `CqrsModule`, and its
  feature modules under `packages/engine/src/` are `auth`, `audit`, `config`, `connectors`,
  `database`, `health`, `onboardings`, `storage`, `webhook` and `workflows`, plus `types/` and
  `utils/` for supporting code.
- `packages/admin-panel` (`@tsh/admin-panel`) — React 19 + Vite operator UI with Azure MSAL SSO,
  TanStack Query and Zod. Tested with Vitest units plus a Playwright suite driven against a live
  engine.
- `packages/shared/ddl-schema` (`@tsh/ddl-schema`) — the workflow JSON contract: the validators and
  the field-type, format, condition, connector, step, transition and webhook registries that make
  workflows declarative. Consumed as a **built** package (`dist`), not as source.
- `packages/shared` (`@tsh/shared`) and `packages/shared/openapi` (`@tsh/openapi`) — placeholder
  packages exporting only a name constant.
- `packages/demo-bff` (`@tsh/demo-bff`) — placeholder package (name/version only, no source yet).
- `packages/demo-web` (`@tsh/demo-web`) — frontend demo package; currently only a Playwright e2e
  skeleton exists, no app source yet.

`workflows/` at the repository root holds the declarative workflow JSON the engine loads at boot
(`WORKFLOWS_DIR`), with reusable fragments under `workflows/templates/`.

The engine follows a vertical feature-module pattern: one folder per feature under
`packages/engine/src/`, containing `<feature>.module.ts` and `<feature>.controller.ts` — see
`packages/engine/src/health/` for the minimal shape and `packages/engine/src/onboardings/` for a
full one. Add `<feature>.service.ts` when business logic is needed. `packages/engine/CLAUDE.md`
carries the full layout contract.

**`docs/IMPLEMENTATION.md` is the baseline for continued development** — read it before making
architectural decisions. It is the as-built specification; its §1 describes the packages and the
core request loop in depth. Four further design documents under `packages/engine/docs/` and one
under `packages/shared/ddl-schema/docs/` carry reasoning it only summarizes.

# Technology Stack

Versions live in the root and per-package `package.json`. The list below is what matters when making
decisions, not a version manifest — check `package.json` before assuming a version.

- Node.js >=24 (`.nvmrc` pins `24`) and pnpm >=11, pinned via the root `packageManager` field. Match
  that pin rather than a globally installed pnpm.
- TypeScript 5 across all packages.
- **Engine:** NestJS 11 (`@nestjs/common`, `core`, `platform-express`, `config`, `cqrs`, `typeorm`,
  `testing`), TypeORM 0.3 with the `pg` driver (Postgres), BullMQ + ioredis for the Redis-backed
  webhook outbox worker, class-validator / class-transformer, `joi`, `jose` (callback signature
  verification), `nodemailer` and `@sendgrid/mail` (email connectors), `@aws-sdk/client-s3` and
  `s3-presigned-post` (document storage), `file-type` and `image-size` (upload validation),
  reflect-metadata, rxjs, dotenv.
- **Admin panel:** React 19, Vite, `@azure/msal-browser` / `@azure/msal-react`, TanStack Query, Zod,
  axios.
- **Testing:** Jest + ts-jest + supertest for `engine` and `ddl-schema`; Vitest + Testing Library for
  `admin-panel`; Playwright for the `admin-panel` and `demo-web` browser suites.
- **Tooling:** ESLint 8 with `@typescript-eslint` at the root (`.eslintrc.cjs`) and ESLint 10 flat
  config inside `admin-panel` (`eslint.config.js`), Prettier, Husky, lint-staged, Changesets.
- **Local stack** via Docker Compose: `postgres:16-alpine`, `redis:7-alpine`, `minio/minio` plus a
  `minio/mc` init container, `mailhog`, and the `engine`, `engine-worker` and `engine-mailhog-test`
  services.

# Coding Conventions

Follow the feature-module pattern for new engine features: create a folder under
`packages/engine/src/<feature>/` with `<feature>.module.ts` and `<feature>.controller.ts`.

Use `packages/engine/src/health/health.controller.ts`-style route versioning for new APIs, for
example:

```ts
@Controller('v1/orders')
export class OrdersController {}
```

Add `<feature>.service.ts` only when the feature has business logic that belongs outside the
controller.

New API routes must use the `v1/` prefix convention, for example `@Controller('v1/orders')`.

Configuration is centralized in `packages/engine/src/config/app.config.ts` in a single `AppConfig`
class. Use `class-validator` decorators such as `@IsEnum`, `@IsNumber`, and `@IsString`, plus enums
like `AppMode` and `StorageDriver`, for constrained values. New env-driven config must be added as
fields on this class, validated via the existing `validateConfig()` function (`plainToInstance` +
`validateSync`), and wired through `ConfigModule.forRoot({ validate: validateConfig })`; **do not
read `process.env` directly in feature code.** Env values needing non-trivial parsing get a sibling
parser in `packages/engine/src/config/` (see `http-connector-secrets.config.ts`,
`connector-callback-secrets.config.ts`, `s3-storage.config.ts`) that `AppConfig` or the consuming
module calls — `AppConfig` stays the single validated surface.

Database migrations live in `packages/engine/src/database/migrations/` and use sequential
numeric-prefixed filenames: `000N_description.ts` (for example `0001_init.ts`), with a matching
PascalCase class name such as `Init0001`. New migrations must continue this numbering sequence. See
`packages/engine/src/database/migrations/CLAUDE.md` for the full naming contract.

Use the TypeScript path aliases `@tsh/shared`, `@tsh/ddl-schema`, `@tsh/openapi` and their `/*`
subpath variants from root `tsconfig.base.json` instead of relative imports across package
boundaries. Note that `@tsh/ddl-schema` resolves to that package's `dist/`, which is why the engine's
`typecheck` and `test:e2e` scripts build it first; Jest maps the same alias back to `src` via
`moduleNameMapper`.

Root `tsconfig.base.json` sets `strict: true`, but `packages/engine/tsconfig.json` currently relaxes
several checks (`strictNullChecks: false`, `noImplicitAny: false`, `strictBindCallApply: false`).
Follow each package's local `tsconfig.json` for that package's code, but **do not introduce new
instances of `any` or unchecked nulls just because strictness is currently relaxed** — write code as
if strict mode were fully enabled.

Prefer concrete, named types for responses, payloads, metadata, and other structured data whenever
their shape can be determined. Avoid `unknown`, `any`, `Record<string, unknown>`, and similar
generic escape hatches when a proper type can express the contract; create a named type with the
relevant fields instead. Keep generic types only at genuinely dynamic boundaries, such as externally
supplied or intentionally open-ended JSON, and do not create named types that add no meaningful
structure merely for the sake of naming them.

## Domain Constants

Applies to all TypeScript across the monorepo (`packages/**/*.ts`):

- Represent domain values used in multiple places (event types, statuses, state identifiers, etc.) as
  a single named enum, const, or type contract. Do not repeat magic strings across the codebase.
- Keep SQL migrations, external wire contracts, and tests verifying raw payloads as the only places
  where literal values are acceptable. Even in tests, prefer reusing the constant when readability is
  not reduced.
- Do not duplicate existing instructions or constants; extend the canonical contract instead.

## Code Design

Name methods with simple operation prefixes or suffixes combined with descriptive nouns, such as
`parseFilters`, `mapWorkflow`, `processOnboarding`, and `findAdapter`. Avoid sophisticated or
over-specific names such as `normalizeAdminOnboardingFilters` and `resolveAdapterByType`.

Use `find<Noun>` for an optional lookup that may return `undefined` when no match exists. Use
`get<Noun>` for a required lookup that returns the value or throws an appropriate error when it does
not exist.

```ts
// Avoid
function normalizeAdminOnboardingFilters(filters: Filters) {}
function resolveAdapterByType(type: AdapterType) {}

// Prefer
function parseFilters(filters: Filters) {}
function findAdapter(type: AdapterType) {}
function getAdapter(type: AdapterType) {
  const adapter = findAdapter(type);

  if (!adapter) {
    throw new Error(`Adapter not found for type: ${type}`);
  }

  return adapter;
}
```

Encapsulate behavior in clearly named classes that fully own one responsibility. Do not create
methods that only delegate to one other method, and avoid excessive private-method decomposition;
keep a larger method when its flow remains coherent.

```ts
// Avoid
class WorkflowProcessor {
  process(data: Data) {
    return this.validate(data);
  }

  private validate(data: Data) {
    return this.checkRequiredFields(data);
  }

  private checkRequiredFields(data: Data) {
    return data;
  }
}

// Prefer
class WorkflowProcessor {
  process(data: Data) {
    // Keep the coherent workflow-processing flow owned here.
    return data;
  }
}
```

Use standard repository methods for ordinary, independent persistence operations. Do not use
transactions by default or excessively; use a transaction only when atomicity or consistency matters,
such as when multiple writes must succeed or fail together.

```ts
// Prefer
await onboardingRepository.save(onboarding);

// Use a transaction only when both writes must be atomic.
await dataSource.transaction(async (manager) => {
  await manager.save(onboarding);
  await manager.save(workflowRun);
});
```

Pass existing domain or application objects to service and class methods. The owning method extracts
or maps the data it needs; do not create a bespoke input type for every method.

```ts
// Avoid
type EvaluateWorkflowInput = {
  data: OnboardingData;
  onboardingId: string;
  workflowVersion: number;
};

workflow.evaluate(input);

// Prefer
workflow.evaluate(data, onboarding);
```

Apply the Strategy pattern when designing genuinely composable or modular systems with multiple
interchangeable, user-defined variants, such as validation for user-defined field types. Keep each
strategy focused on one variant so new field-type strategies can be added without changing the core
validation flow. Do not use Strategy for every small conditional or simple operation; keep the design
proportional.

```ts
interface FieldValidationStrategy {
  supports(field: FieldDefinition): boolean;
  validate(value: unknown, field: FieldDefinition): ValidationError[];
}

class TextFieldValidationStrategy implements FieldValidationStrategy {
  supports(field: FieldDefinition) {
    return field.type === 'text';
  }

  validate(value: unknown, field: FieldDefinition) {
    return typeof value === 'string' ? [] : [{ field: field.name }];
  }
}

class NumberFieldValidationStrategy implements FieldValidationStrategy {
  supports(field: FieldDefinition) {
    return field.type === 'number';
  }

  validate(value: unknown, field: FieldDefinition) {
    return typeof value === 'number' ? [] : [{ field: field.name }];
  }
}
```

Follow the KISS principle: prefer the simplest design that clearly satisfies the requirements. Do not
introduce abstractions, patterns, classes, or indirection without a concrete need.

Avoid declaring a `let` response solely to assign it inside a `try` block and use it after a `catch`
block. Extract handling for the specific error boundary or restructure the control flow so the
successful result and failure path remain explicit.

# Error Handling

No custom NestJS exception filters exist yet, so rely on NestJS's default exception handling and
framework-level HTTP exceptions (`HttpException` and subclasses). For stable client-facing HTTP error
contracts, follow the HTTP error conventions in `packages/engine/CLAUDE.md`.

Required configuration must fail fast at bootstrap: use `ConfigService.getOrThrow<T>('VAR_NAME')` for
required environment variables, as done for `DATABASE_URL`, and never `get()` with a silent fallback
for values the app cannot run without.

Config validation errors are surfaced eagerly at startup via `validateConfig()`, which throws a plain
`Error` with concatenated `class-validator` messages when validation fails; follow this pattern for
any new config validation.

A global `ValidationPipe({ whitelist: true, transform: true })` is registered in `main.ts`, so all
incoming request DTOs are validated and transformed automatically. New endpoints must define DTOs
with `class-validator` and `class-transformer` decorators rather than manual validation.

# Testing Strategy

Root `jest.base.config.cjs` sets `testEnvironment: 'node'`, `clearMocks: true`, and
`restoreMocks: true`; package-level Jest configs extend this base and do not duplicate these
settings.

Engine unit tests are co-located `*.spec.ts` files next to the source they test, for example
`packages/engine/src/health/health.controller.spec.ts`. `packages/engine/jest.config.cjs` selects them
via `testMatch: ['<rootDir>/src/**/*.spec.ts']`, compiles with `ts-jest` against `tsconfig.spec.json`,
and maps `@tsh/ddl-schema` to that package's `src`. The scripts run Jest under
`node --experimental-vm-modules` with an explicit `--config`; always go through the pnpm scripts
rather than reconstructing the command.

Engine e2e/integration tests live under `packages/engine/test/**/*.e2e-spec.ts` and are configured
via `packages/engine/test/jest-e2e.config.cjs`, which extends the root base config, uses `ts-jest`,
and maps `@tsh/*` aliases via `moduleNameMapper`. They run `--runInBand` against the real stack.
Follow the existing pattern in `health.e2e-spec.ts`: set required env vars in `beforeAll`, dynamically
import `AppModule`, build the module with `Test.createTestingModule`, call `app.init()`, and exercise
the app with `supertest` against `app.getHttpServer()`; assert database side effects directly against
the live `DataSource` when relevant.

`packages/shared/ddl-schema` has its own Jest config and co-located `*.spec.ts` files, covering the
workflow contract and validators.

`admin-panel` unit tests use **Vitest** (`vitest.config.ts`) with Testing Library and a `jsdom`
environment, run via `vitest run`. Its Playwright suite (`playwright.config.ts`) is launched by
`e2e/run-direct-engine-playwright.cjs` — that runner brings up a real engine and starts the Vite dev
server on whatever port `BASE_URL` names, so drive it through `pnpm --filter @tsh/admin-panel test:e2e`
rather than `playwright` directly.

`demo-web` e2e tests use Playwright (`playwright.config.ts`): tests live under `./e2e`, the project is
chromium-only, `baseURL` comes from the `BASE_URL` env var with default `http://localhost:5173`, the
run is headless, and retries are disabled.

New packages that add tests must wire `test`, `test:cov`, and, if applicable, `test:e2e` or
`test:integration` npm scripts so root-level recursive `pnpm -r --if-present run <script>` commands
pick them up automatically.

# Development Workflow

**Always use the pnpm scripts defined in the root `package.json`; never invoke `docker compose`,
`jest`, or `playwright` directly.**

**After every implementation or code change, immediately run `pnpm format:fix` from the repository
root.** Treat any Prettier errors or warnings as blocking, and fix them immediately before
continuing. This is the canonical repository-wide Prettier fix command.

- `pnpm bootstrap` — installs dependencies from the lockfile and sets up Husky hooks
  (`node scripts/bootstrap.cjs`)
- `pnpm stack:config` — validates the Docker Compose file (`node scripts/compose.cjs config`)
- `pnpm stack:up` — starts the local stack (Postgres, Redis, MinIO, MailHog, engine, engine-worker)
  via `node scripts/compose.cjs up -d --build`
- `pnpm stack:down` — stops the stack (`node scripts/compose.cjs down --remove-orphans`)
- `pnpm stack:ps` / `pnpm stack:logs` — inspect running services or tail logs
- `pnpm stack:integration:up` — stops `engine-worker`, then brings the stack up and waits for
  `engine`; use it when a worker competing for the outbox would make an integration test
  nondeterministic
- `pnpm test:e2e` — orchestrates a full e2e run: brings the stack up
  (`compose up -d --build --wait engine`), runs `pnpm -r --if-present run test:e2e` across packages,
  and always tears the stack down afterward via a `finally` block (`node scripts/test-e2e.cjs`)
- `pnpm test:e2e:ci` — the package-level e2e pass on its own
  (`pnpm -r --if-present run test:e2e`), for use when the stack is already up, as in CI
- `pnpm test:mailhog:integration` — runs the SMTP connector against the MailHog service
  (`node scripts/test-mailhog-integration.cjs`)
- `pnpm lint` / `pnpm lint:fix` / `pnpm typecheck` / `pnpm build` / `pnpm test` / `pnpm test:cov` /
  `pnpm test:integration` — all run recursively across packages via
  `pnpm -r --if-present run <script>`
- `pnpm format` is check-only and currently runs check scripts for `packages/engine` and
  `packages/shared/ddl-schema`; it is still not a full-repository formatting gate. Use
  `pnpm format:fix` for the canonical repository-wide formatting check and fix workflow; do not use
  raw `prettier` commands as the normal workflow.
- `pnpm changeset` — records a changeset for versioning (Changesets workflow)

Copy `.env.dist` to `.env` (`cp .env.dist .env`) before starting the stack. `ConfigModule` reads
`.env` only — `.env.dist` is the sample, not a fallback, so a missing `.env` fails at boot.

**`.env.dist` is the authoritative list of environment variables, and
`packages/engine/src/config/` is the authoritative source for which are required and how they are
validated.** Read those rather than trusting an enumeration here. The variables group into: app and
runtime (`MODE`, `PORT`, `NODE_ENV`, `WORKFLOWS_DIR`, `ADMIN_PANEL_ORIGIN`); Postgres and Redis
(`DATABASE_URL`, `REDIS_URL` and their host-port overrides); storage (`STORAGE_DRIVER` and the
`STORAGE_S3_*` set); admin auth (`ADMIN_SSO_PROVIDER`, `ADMIN_AUTH_ENABLED`, `ADMIN_REQUIRED_ROLES`,
and the `VITE_*` mirrors the panel reads at build time); connectors (`TWILIO_*`, `SENDGRID_*`,
`HTTP_CONNECTOR_*`, `CONNECTOR_CALLBACK_*`); and the client webhook outbox
(`CLIENT_WEBHOOK_*`, `WEBHOOK_OUTBOX_*`).

The pre-commit hook (Husky + lint-staged) runs automatically on `git commit`: ESLint
(`--max-warnings=0`) on `*.{js,cjs,mjs,ts,tsx}` and Prettier `--check` on
`*.{js,cjs,mjs,ts,tsx,json,md,yml,yaml}`. Code must pass both before committing.

CI runs in both GitHub Actions (`.github/workflows/ci.yml`) and Bitbucket Pipelines
(`bitbucket-pipelines.yml`), kept in sync, on every branch and pull request:

`corepack enable` → `pnpm install --frozen-lockfile` → `cp .env.dist .env` → `pnpm lint` →
`pnpm typecheck` → `pnpm build` → `pnpm test:cov` → install Playwright chromium for **both**
`@tsh/demo-web` and `@tsh/admin-panel` → `pnpm test:e2e:ci` → `pnpm test:mailhog:integration`.

Postgres and Redis are declared as CI services. MinIO cannot be: neither platform lets a service
definition override an image command, and `minio/minio`'s default CMD only prints help and exits, so
it is started as a plain `docker run` container and torn down afterwards. **Do not switch to the
Bitnami MinIO image — `bitnamilegacy` is archived and frozen.**

**Changes must pass this same sequence locally before pushing** — `/verify` runs it for you.

# As-Built Documentation — `docs/IMPLEMENTATION.md`

- `docs/IMPLEMENTATION.md` is the as-built specification: it describes what exists in this codebase,
  and it is the **single** starting point for anyone continuing development. There is no external or
  historical specification for this system — do not look for one, cite one, or reason from one.
- **`docs/IMPLEMENTATION.md` must describe the current state of the app at all times.** Any change to
  the codebase is reflected there in the same change. There is no acceptable window in which the code
  and this document disagree.
- **A spec document added to drive new work is a transient input, not a reference.** When a `SPEC.md`
  (or any spec file) describing a feature to build appears in the repository: implement it, fold its
  substance into `docs/IMPLEMENTATION.md` as part of the same change, and then delete the spec file.
  State in your summary that you deleted it and what it covered. Keep it only if part of what it
  describes is still unbuilt — then leave it in place and say exactly what remains.
- **Whenever a feature is added, changed, or removed, update `docs/IMPLEMENTATION.md` as part of the
  same change.** A merged feature that is not described there makes the document wrong, and a reader
  cannot tell which other parts have also gone stale.
- The document's section-by-section update map, and the rules for what belongs in it, live in its own
  section 0. Follow them; do not restate them here.
- Describe the present tense only. Roadmaps, planned work, recommendations, and unmerged branches do
  not belong in the as-built document. A feature behind a disabled flag is described as present and
  off by default.
- Every claim must be checkable against a named file. Do not carry a claim forward from an earlier
  revision without re-verifying it against the current code.
- State the reasoning behind a mechanism, not only the mechanism. That reasoning is the document's
  main value over reading the source.
- Record absences, unreachable code, and known rough edges plainly in the section that covers them.
- Unlike the instruction files, which are human-governed and changed only after explicit
  confirmation, `docs/IMPLEMENTATION.md` is expected to be updated directly alongside the code it
  describes.

# Keeping These Instructions Current

This file, the nested `CLAUDE.md` files, and the mirrored Copilot instructions
(`.github/copilot-instructions.md` and `.github/instructions/*.instructions.md`) must evolve with the
codebase, but **never silently**.

When you make or observe a change that would make any section of any of those files inaccurate or
incomplete — a new package, a new top-level script, a dependency or version bump, a new architectural
pattern, a new coding convention, a change to error-handling or testing practices, or a change to
file-scoped conventions — **do not edit the affected file as a side effect of that work.**

Instead:

- Call out which file and section(s) are now stale and why.
- Propose the exact replacement text for those sections.
- Apply the update only after the user explicitly confirms it.

`/propose-instruction-update` runs this flow.

The `.github/` instruction files carry the same rules for GitHub Copilot. They are a deliberate
mirror, not an independent source of truth: when a confirmed update lands in a `CLAUDE.md`, propose
the equivalent edit to the matching `.github/` file in the same change, and vice versa.

Treat all instruction files as reviewed, human-governed documents. Proposing updates keeps them
accurate without introducing unreviewed changes to the project's conventions.
