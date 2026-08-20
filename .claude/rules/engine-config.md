---
paths:
  - 'packages/engine/src/**/*.ts'
---

# Engine configuration

- All env-driven configuration is declared as fields on the single `AppConfig` class
  in `packages/engine/src/config/app.config.ts`, constrained with `class-validator`
  decorators and enums such as `AppMode` and `StorageDriver`.
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
