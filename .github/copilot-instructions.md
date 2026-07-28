> **This file is the project constitution.** Every rule below is a hard constraint — not a suggestion, not a guideline. Copilot must follow these rules in all interactions with this repository without exception. When in doubt, these instructions take precedence over general knowledge or external best practices.

# Architecture

This repository is a monorepo managed with pnpm workspaces (`pnpm-workspace.yaml`: `packages/*` and `packages/shared/*`).

The packages are:

- `packages/engine` (`@tsh/engine`) — NestJS backend, the core orchestrator service. It wires `ConfigModule`, `TypeOrmModule` (Postgres), `CqrsModule` (CQRS pattern), and feature modules such as `HealthModule`. This is the only package with substantive business logic today.
- `packages/demo-bff` (`@tsh/demo-bff`) — placeholder package (name/version only, no source yet).
- `packages/demo-web` (`@tsh/demo-web`) — frontend demo package; currently only a Playwright e2e skeleton exists, no app source yet.
- `packages/shared` (`@tsh/shared`), `packages/shared/ddl-schema` (`@tsh/ddl-schema`), `packages/shared/openapi` (`@tsh/openapi`) — shared libraries consumed by other packages via TypeScript path aliases; currently placeholder exports only.

The engine follows a feature-module pattern: one folder per feature under `packages/engine/src/`, containing `<feature>.module.ts` and `<feature>.controller.ts` (see `packages/engine/src/health/`). Add `<feature>.service.ts` when business logic is needed.

The README references a `SPEC.md` architecture doc and an `ONBOARDING_SPEC/` directory, but neither exists in the repository. Do not assume those documents exist or invent their contents; rely only on the actual codebase structure described here.

# Technology Stack

- Node.js >=24.0.0 (`.nvmrc` pins `24`)
- pnpm >=11.0.0, pinned via `packageManager` field to `pnpm@11.12.0`
- TypeScript ^5.0.0
- NestJS 11.1.28 (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/testing`), `@nestjs/config` 4.0.4, `@nestjs/cqrs` 11.0.3, `@nestjs/typeorm` 11.0.3, with `@nestjs/cli` 11.0.24 and `@nestjs/schematics` 11.1.0
- TypeORM ^0.3.25 with `pg` ^8.13.1 driver (Postgres)
- class-validator ^0.15.1, class-transformer ^0.5.1, `joi` ^18.2.3, reflect-metadata ^0.2.2, rxjs ^7.8.2
- dotenv ^17.4.2
- Jest ^29.5.0 with ts-jest ^29.1.0, supertest ^7.2.2
- Playwright (`@playwright/test`) ^1.54.2 for `demo-web` e2e
- ESLint ^8.42.0 with `@typescript-eslint/*` ^6.0.0 and `eslint-config-prettier` ^10.1.8
- Prettier ^3.0.0
- Husky ^9.0.0, lint-staged ^15.0.0, Changesets (`@changesets/cli`) ^2.0.0
- Local stack via Docker Compose: `postgres:16-alpine`, `redis:7-alpine`, `minio/minio:latest` + `minio/mc:latest` init container

# Coding Conventions

Follow the feature-module pattern for new engine features: create a folder under `packages/engine/src/<feature>/` with `<feature>.module.ts` and `<feature>.controller.ts`.

Use `packages/engine/src/health/health.controller.ts`-style route versioning for new APIs, for example:

```ts
@Controller('v1/orders')
export class OrdersController {}
```

Add `<feature>.service.ts` only when the feature has business logic that belongs outside the controller.

Configuration is centralized in `packages/engine/src/config/app.config.ts` in a single `AppConfig` class. Use `class-validator` decorators such as `@IsEnum`, `@IsNumber`, and `@IsString`, plus enums like `AppMode` and `StorageDriver`, for constrained values. New env-driven config must be added as fields on this class, validated via the existing `validateConfig()` function (`plainToInstance` + `validateSync`), and wired through `ConfigModule.forRoot({ validate: validateConfig })`; do not read `process.env` directly in feature code.

Database migrations live in `packages/engine/src/database/migrations/` and use sequential numeric-prefixed filenames: `000N_description.ts` (for example `0001_init.ts`), with a matching PascalCase class name such as `Init0001`. New migrations must continue this numbering sequence.

Use the TypeScript path aliases `@tsh/shared`, `@tsh/ddl-schema`, `@tsh/openapi` and their `/*` subpath variants from root `tsconfig.base.json` instead of relative imports across package boundaries.

Root `tsconfig.base.json` sets `strict: true`, but `packages/engine/tsconfig.json` currently relaxes several checks (`strictNullChecks: false`, `noImplicitAny: false`, `strictBindCallApply: false`). Follow each package's local `tsconfig.json` for that package's code, but do not introduce new instances of `any` or unchecked nulls just because strictness is currently relaxed — write code as if strict mode were fully enabled.

New API routes must use the `v1/` prefix convention, for example `@Controller('v1/orders')`.

## Code Design

Name methods with simple operation prefixes or suffixes combined with descriptive nouns, such as `parseFilters`, `mapWorkflow`, `processOnboarding`, and `findAdapter`. Avoid sophisticated or over-specific names such as `normalizeAdminOnboardingFilters` and `resolveAdapterByType`.

Use `find<Noun>` for an optional lookup that may return `undefined` when no match exists. Use `get<Noun>` for a required lookup that returns the value or throws an appropriate error when it does not exist.

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

Encapsulate behavior in clearly named classes that fully own one responsibility. Do not create methods that only delegate to one other method, and avoid excessive private-method decomposition; keep a larger method when its flow remains coherent.

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

Use standard repository methods for ordinary, independent persistence operations. Do not use transactions by default or excessively; use a transaction only when atomicity or consistency matters, such as when multiple writes must succeed or fail together.

```ts
// Prefer
await onboardingRepository.save(onboarding);

// Use a transaction only when both writes must be atomic.
await dataSource.transaction(async (manager) => {
  await manager.save(onboarding);
  await manager.save(workflowRun);
});
```

Pass existing domain or application objects to service and class methods. The owning method extracts or maps the data it needs; do not create a bespoke input type for every method.

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

Apply the Strategy pattern when designing genuinely composable or modular systems with multiple interchangeable, user-defined variants, such as validation for user-defined field types. Keep each strategy focused on one variant so new field-type strategies can be added without changing the core validation flow. Do not use Strategy for every small conditional or simple operation; keep the design proportional.

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

Follow the KISS principle: prefer the simplest design that clearly satisfies the requirements. Do not introduce abstractions, patterns, classes, or indirection without a concrete need.

## Scoped Instruction Files

The files in `.github/instructions/` contain scoped, file-pattern-specific conventions. Follow them whenever matching files are in context:

- [Engine architecture conventions](instructions/engine-architecture.instructions.md)
- [HTTP error conventions](instructions/http-errors.instructions.md)
- [Database migration conventions](instructions/database-migrations.instructions.md)

# Error Handling

No custom NestJS exception filters exist yet, so rely on NestJS's default exception handling and framework-level HTTP exceptions (`HttpException` and subclasses).
For stable client-facing HTTP error contracts, follow [the HTTP error conventions](instructions/http-errors.instructions.md).

Required configuration must fail fast at bootstrap: use `ConfigService.getOrThrow<T>('VAR_NAME')` for required environment variables, as done for `DATABASE_URL`, and never `get()` with a silent fallback for values the app cannot run without.

Config validation errors are surfaced eagerly at startup via `validateConfig()`, which throws a plain `Error` with concatenated `class-validator` messages when validation fails; follow this pattern for any new config validation.

A global `ValidationPipe({ whitelist: true, transform: true })` is registered in `main.ts`, so all incoming request DTOs are validated and transformed automatically. New endpoints must define DTOs with `class-validator` and `class-transformer` decorators rather than manual validation.

# Testing Strategy

Root `jest.base.config.cjs` sets `testEnvironment: 'node'`, `clearMocks: true`, and `restoreMocks: true`; package-level Jest configs extend this base and do not duplicate these settings.

Engine unit tests are co-located `*.spec.ts` files next to the source they test, for example `packages/engine/src/health/health.controller.spec.ts`, and run via `jest --testMatch "<rootDir>/src/**/*.spec.ts"`.

Engine e2e/integration tests live under `packages/engine/test/**/*.e2e-spec.ts` and are configured via `packages/engine/test/jest-e2e.config.cjs`, which extends the root base config, uses `ts-jest`, and maps `@tsh/*` aliases via `moduleNameMapper`. Follow the existing pattern in `health.e2e-spec.ts`: set required env vars in `beforeAll`, dynamically import `AppModule`, build the module with `Test.createTestingModule`, call `app.init()`, and exercise the app with `supertest` against `app.getHttpServer()`; assert database side effects directly against the live `DataSource` when relevant.

`demo-web` e2e tests use Playwright (`playwright.config.ts`): tests live under `./e2e`, the project is chromium-only, `baseURL` comes from the `BASE_URL` env var with default `http://localhost:5173`, the run is headless, and retries are disabled.

New packages that add tests must wire `test`, `test:cov`, and, if applicable, `test:e2e` or `test:integration` npm scripts so root-level recursive `pnpm -r --if-present run <script>` commands pick them up automatically.

# Development Workflow

Always use the pnpm scripts defined in the root `package.json`; never invoke `docker compose`, `jest`, or `playwright` directly.

After every implementation or code change, immediately run `pnpm format:fix` from the repository root. Treat any Prettier errors or warnings as blocking, and fix them immediately before continuing. This is the canonical repository-wide Prettier fix command.

- `pnpm bootstrap` — installs dependencies from the lockfile and sets up Husky hooks (`node scripts/bootstrap.cjs`)
- `pnpm stack:config` — validates the Docker Compose file (`node scripts/compose.cjs config`)
- `pnpm stack:up` — starts the local stack (Postgres, Redis, MinIO, engine) via `node scripts/compose.cjs up -d --build`
- `pnpm stack:down` — stops the stack (`node scripts/compose.cjs down --remove-orphans`)
- `pnpm stack:ps` / `pnpm stack:logs` — inspect running services or tail logs
- `pnpm test:e2e` — orchestrates a full e2e run: brings the stack up (`compose up -d --build --wait engine`), runs `pnpm -r --if-present run test:e2e` across packages, and always tears the stack down afterward via a `finally` block (`node scripts/test-e2e.cjs`)
- `pnpm lint` / `pnpm lint:fix` / `pnpm typecheck` / `pnpm build` / `pnpm test` / `pnpm test:cov` / `pnpm test:integration` — all run recursively across packages via `pnpm -r --if-present run <script>`
- `pnpm format` is check-only and currently runs check scripts for `packages/engine` and `packages/shared/ddl-schema`; it is still not a full-repository formatting gate. Use `pnpm format:fix` for the canonical repository-wide formatting check and fix workflow; do not use raw `prettier` commands as the normal workflow.
- `pnpm changeset` — records a changeset for versioning (Changesets workflow)

Copy `.env.dist` to `.env` (`cp .env.dist .env`) before starting the stack. Required env vars are `MODE`, `PORT`, `NODE_ENV`, `DATABASE_URL`, `REDIS_URL`, `STORAGE_DRIVER`, `STORAGE_S3_BUCKET`, `STORAGE_S3_REGION`, `STORAGE_S3_ENDPOINT`, `STORAGE_S3_FORCE_PATH_STYLE`, `STORAGE_S3_ACCESS_KEY_ID`, and `STORAGE_S3_SECRET_ACCESS_KEY`.

The pre-commit hook (Husky + lint-staged) runs automatically on `git commit`: ESLint (`--max-warnings=0`) on `*.{js,cjs,mjs,ts,tsx}` and Prettier `--check` on `*.{js,cjs,mjs,ts,tsx,json,md,yml,yaml}`. Code must pass both before committing.

CI (Bitbucket Pipelines and GitHub Actions, kept in sync) runs: `corepack enable` → `pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm typecheck` → `pnpm build` → `pnpm test:cov` → install Playwright browsers for `demo-web` → `pnpm test:e2e:ci`. Changes must pass this same sequence locally before pushing.

# Keeping These Instructions Current

This file — and any granular `*.instructions.md` files under `.github/instructions/` that exist in the repository — must evolve with the codebase, but never silently. When you make or observe a change that would make any section of this file, or any granular instructions file, inaccurate or incomplete — a new package, a new top-level script, a dependency or version bump, a new architectural pattern, a new coding convention, a change to error-handling or testing practices, or a change to file-scoped conventions covered by a granular instructions file — do not edit the affected file as a side effect of that work.

Instead:

- Call out which file and section(s) are now stale and why.
- Propose the exact replacement text for those sections.
- Apply the update only after the user explicitly confirms it.

Treat all instruction files as reviewed, human-governed documents. Proposing updates keeps them accurate without introducing unreviewed changes to the project's conventions.
