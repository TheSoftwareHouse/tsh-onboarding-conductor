---
description: Scaffold a new engine feature module following the vertical-module conventions
argument-hint: <feature-name> [what it should do]
---

Scaffold a new engine feature: **$ARGUMENTS**

This is the direct route: scaffold, format, typecheck, document. For a change that warrants a plan
reviewed before code is written and an adversarial review pass afterwards, use `/ship` instead.

Read `packages/engine/CLAUDE.md` and the root `CLAUDE.md` first, then follow the existing
`packages/engine/src/health/` and `packages/engine/src/onboardings/` modules as the shape reference —
do not invent a new layout.

What to create under `packages/engine/src/<feature>/`:

- `<feature>.module.ts` and `<feature>.controller.ts` at the feature root.
- `<feature>.service.ts` **only** if there is business logic that does not belong in the controller.
  If the controller is a thin passthrough, do not add a service to have one.
- Supporting artifacts in intent-revealing subdirectories: `dto/`, `entity/`, `errors/`, `domain/`,
  `transport/`. Never per-role nested roots.
- Co-located `*.spec.ts` unit specs next to what they test.
- Register the module in `packages/engine/src/app.module.ts`.

Contracts that apply:

- Route prefix `v1/`, e.g. `@Controller('v1/<feature>')`.
- Request DTOs use `class-validator` / `class-transformer` decorators; the global
  `ValidationPipe({ whitelist: true, transform: true })` does the rest. No manual validation.
- Client-facing errors are feature-local classes in `<feature>/errors/`, each owning a fixed
  `{ code, message }` and the correct semantic HTTP status.
- No `process.env` reads — new config goes on `AppConfig` in `packages/engine/src/config/app.config.ts`.
- Concrete named types over `unknown` / `any` / `Record<string, unknown>`.
- KISS: no repository, strategy, or abstraction layer until this feature actually needs one.

Then: run `pnpm format:fix`, `pnpm lint` and `pnpm typecheck`, and update `docs/IMPLEMENTATION.md` per
its section 0 update map (a new endpoint means §11 plus the owning section) — that document must
describe the current state of the app at all times, so this is part of the change, not a follow-up.

If a spec file in the repository drove this feature, fold its substance into `docs/IMPLEMENTATION.md`
and delete it, saying so in your summary. Keep it only if part of what it describes is still unbuilt,
and state exactly what remains.

Finally, tell me if any instruction file has gone stale — propose the text, do not edit it.
