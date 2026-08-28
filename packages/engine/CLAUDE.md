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

There is no custom exception filter; Nest's default HTTP exception handling applies.
Errors are two-tier, and the filename says which tier a class belongs to.

- `<feature>/errors/*.exception.ts` — client-facing. Extends the Nest HTTP exception
  subclass carrying the correct semantic status (`NotFoundException`,
  `ConflictException`, `BadRequestException`, `GoneException`,
  `UnauthorizedException`, `InternalServerErrorException`).
- `<feature>/errors/*.error.ts` — internal domain errors. Extends plain `Error` and
  sets `this.name`. These are not thrown across the HTTP boundary unmapped.

Each exception owns a fixed `{ code, message }` payload in its own constructor, so
call sites throw the class instead of repeating the literal:

```ts
export class OnboardingNotFoundException extends NotFoundException {
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

## Conventions that apply here but are owned centrally

These stay in `.claude/rules/` (repo root) because they apply to every workspace, not
just this one — duplicating them here would create a second copy that drifts. They
load automatically when Claude reads a matching file:

- `code-design.md`, `domain-constants.md` — `packages/**/*.ts`
- `testing.md` — test files and configs across every package
