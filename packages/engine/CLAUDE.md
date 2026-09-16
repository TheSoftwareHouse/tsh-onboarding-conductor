# @tsh/engine

The orchestrator: a NestJS + TypeORM service that loads workflow definitions, runs
onboardings against them, and drives connectors, webhooks and email. All business
logic lives here — `packages/admin-panel` only reads from it over HTTP.

This package also ships and serves that panel. `Dockerfile` builds it in the same
`build` stage as the engine and carries its `dist/` into the runtime stage, and
`src/admin-panel/admin-panel-static.ts` serves it from this service's own origin,
including the `/config.js` it renders from `ConfigService`. See
`docs/decisions/0004-admin-panel-served-by-the-engine.md`.

`docs/IMPLEMENTATION.md` (repo root) is the as-built spec for this package's runtime
behaviour — DDL evaluation, connectors, webhook outbox, audit log, persistence. Read
it before changing any of those areas; this file only orients within the package.

## Architecture

- Features are vertical modules under `src/<feature>/`. The primary roles —
  `<feature>.controller.ts`, `<feature>.module.ts`, `<feature>.service.ts`,
  `<feature>.repository.ts` and their co-located `*.spec.ts` — stay at the feature
  root.
- Add a service only when business logic belongs outside the controller.
- Supporting artifacts go in intent-revealing subdirectories of the feature: `dto`,
  `entity`, `errors`, `domain`, `transport`, `testing`. Do not create per-role nested
  roots.
- Framework-independent domain logic must not import Nest decorators or depend on
  HTTP/transport concerns.
- Keep types local to the owning module or class until real reuse establishes a
  boundary. Do not create shared type modules preemptively.
- Admin routes are marked `@AdminRoute()` (`src/auth/admin-route.decorator.ts`), never a bare
  `@UseGuards(AzureJwtGuard)`: the decorator applies the guard and writes its contract into the
  OpenAPI document, so the two cannot disagree.
- Every route and DTO carries `@nestjs/swagger` metadata, and response shapes are decorated
  classes under `dto/` (domain types stay plain; the DTO mirrors them). `.claude/rules/api-docs.md`
  states the conventions; `src/openapi/openapi-document.spec.ts` holds the committed
  `packages/shared/openapi/engine.openapi.json` equal to the code.
- REST routes carry a version prefix: `@Controller('v1/onboardings')`. This is now
  load-bearing, not just tidy: the engine serves the admin panel at every path outside
  `/v1`, so a controller mounted without the prefix is answered with the panel's
  `index.html` and a 200 instead of reaching its handler.
- Cross-package imports use the `@tsh/shared`, `@tsh/ddl-schema` and `@tsh/openapi`
  path aliases from `tsconfig.base.json`, never relative paths across packages.

## Configuration

- All env-driven configuration is declared as fields on the single `AppConfig` class
  in `src/config/app.config.ts`, constrained with `class-validator` decorators and
  enums such as `AppMode` and `StorageDriver`.
- New config is validated through the existing `validateConfig()`
  (`plainToInstance` + `validateSync`), wired via
  `ConfigModule.forRoot({ validate: validateConfig })`. Validation failures throw at
  startup — configuration fails fast, never silently.
- Never read `process.env` directly in feature code.
- For values the app cannot run without, use `ConfigService.getOrThrow<T>('VAR')`.
  Never `get()` with a silent fallback.
- `main.ts` registers a global `ValidationPipe({ whitelist: true, transform: true })`,
  so request DTOs are validated and transformed automatically. Define DTOs with
  `class-validator` / `class-transformer` decorators rather than validating by hand.

## Error contracts

One global filter exists: `ApiFailureAuditFilter`
(`src/audit/api-failure-audit.filter.ts`), registered as `APP_FILTER` in
`AuditModule`. It exists **only to write an audit row** for non-success responses —
it extends `BaseExceptionFilter` and delegates all serialization to
`super.catch(...)`. It **must not change any response** (body, status or header,
including in future edits to it); Nest's default HTTP exception handling still
governs what callers receive. The global `ValidationPipe` (`main.ts`) now takes an
`exceptionFactory` producing `ValidationFailedException`, which reproduces Nest's
default 400 body byte-for-byte while exposing constraint keys for the audit row, so
DTO rejections still look identical to callers.

Errors are two-tier, and the filename says which tier a class belongs to.

- `<feature>/errors/*.exception.ts` — client-facing. Extends the Nest HTTP exception
  subclass carrying the correct semantic status (`NotFoundException`,
  `ConflictException`, `BadRequestException`, `GoneException`,
  `UnauthorizedException`, `InternalServerErrorException`).
- `<feature>/errors/*.error.ts` — internal domain errors. Extends plain `Error` and
  sets `this.name`. These are not thrown across the HTTP boundary unmapped.

Each exception owns a fixed `{ code, message }` payload in its own constructor, so
call sites throw the class instead of repeating the literal, and a `static apiDescription` —
the one line the OpenAPI document prints beside the code:

```ts
export class OnboardingNotFoundException extends NotFoundException {
  static readonly apiDescription = 'No onboarding has this id.';

  constructor() {
    super({
      code: 'ONBOARDING_NOT_FOUND',
      message: 'ONBOARDING_NOT_FOUND',
    });
  }
}
```

Do not introduce a global error enum or map as the public error contract.

## Database migrations (`src/database/migrations/`)

- Filenames use a sequential numeric prefix and a snake-case stem:
  `000N_description.ts`. Continue the existing sequence; never renumber.
- The class name is PascalCase ending in the sequence number: `CreateOnboardings0002`.
- The instance `name` is `<filename_stem>_<13-digit-timestamp>`. TypeORM parses the
  final 13 characters as a timestamp, so the name must end in exactly 13 digits.

```ts
export class CreateOnboardings0002 implements MigrationInterface {
  name = '0002_create_onboardings_1735689600000';
}
```

Raw SQL literals are acceptable here — migrations are a snapshot of the schema at a
point in time and must not depend on constants that later change.

A new table's `CREATE TABLE` body must never carry a `FOREIGN KEY` clause. Declare the
relation on the entity first — a `@ManyToOne`/`@JoinColumn` pair carrying `onDelete`
and `foreignKeyConstraintName`, or `createForeignKeyConstraints: false` for a
deliberately unenforced reference — then have the migration add the constraint with a
standalone `ALTER TABLE … ADD CONSTRAINT`, its name and `ON DELETE` action matching the
decorator exactly. See decision record
[0019](../../docs/decisions/0019-relations-declared-on-entities.md) and
`test/foreign-keys.e2e-spec.ts`, which fails if the two ever disagree.

## Package-specific pitfalls

- `typecheck` and `test:e2e` run `pnpm --filter @tsh/ddl-schema build` first — the
  engine imports `@tsh/ddl-schema` from its built `dist`, not from source, so a stale
  `ddl-schema` build produces confusing type errors that look like they belong to
  the engine.
- `packages/engine/docs/*.md` holds deep-dive references for specific subsystems
  (audit log contract, connector callback signatures, the generic HTTP connector,
  step data validation) — narrower than `docs/IMPLEMENTATION.md` and worth reading
  before touching those specific areas.
- `test/*.e2e-spec.ts` boots the real `AppModule` against the Docker stack; it needs
  `pnpm test:e2e` (via the root script), never a direct `jest` invocation.
- The e2e suites run against a Compose volume that outlives them, so a suite that
  changes the schema has to leave assertions that read it still true on the next run.
  `onboardings.e2e-spec.ts` cycles migration 0007 down and up, which re-adds
  `rejection_reason` at the end of the physical column order for good — Postgres cannot
  move a column back. Its schema-shape assertion therefore compares columns by name
  (`byColumnName`), and a new one must do the same rather than pin `ordinal_position`.
- A workflow document is a list of typed steps, in specs too. A spec that states a
  rule of the compiled form may still write untyped steps and load them through
  `src/workflows/testing/untyped-steps.helper.ts` (`normalizeUntypedSteps`); a spec
  that writes JSON into a temporary `WORKFLOWS_USERS_DIR` writes typed steps.
- A file under `src/database/migrations/` may export only its migration class —
  TypeORM instantiates every export the glob finds — so a migration's spec sits one
  level up, in `src/database/`.
- `pnpm test` failing in `src/openapi/openapi-document.spec.ts` with a large diff means a route,
  DTO or error contract changed and `pnpm openapi:generate` was not run. Regenerate; do not edit
  the JSON.
- `src/openapi/generate-openapi.ts` and `src/openapi/testing/` import `@nestjs/testing` and are
  excluded from the build in `tsconfig.build.json`; moving them pulls a dev dependency into
  `dist`.

## Conventions that apply here but are owned centrally

These stay in `.claude/rules/` (repo root) because they apply to every workspace, not
just this one — duplicating them here would create a second copy that drifts. They
load automatically when Claude reads a matching file:

- `code-design.md`, `constants.md` — `packages/**/*.{ts,tsx}`
- `testing.md` — test files and configs across every package
- `api-docs.md` — controllers, `dto/` and `errors/*.exception.ts` under `packages/engine/src`, and
  `src/openapi/`
