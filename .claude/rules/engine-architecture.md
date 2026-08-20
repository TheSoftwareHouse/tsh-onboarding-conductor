---
paths:
  - 'packages/engine/src/**/*.ts'
---

# Engine architecture

- Features are vertical modules under `packages/engine/src/<feature>/`. The primary
  roles — `<feature>.controller.ts`, `<feature>.module.ts`, `<feature>.service.ts`,
  `<feature>.repository.ts` and their co-located `*.spec.ts` — stay at the feature root.
- Add a service only when business logic belongs outside the controller.
- Supporting artifacts go in intent-revealing subdirectories of the feature:
  `dto`, `entity`, `errors`, `domain`, `transport`, `testing`. Do not create
  per-role nested roots.
- Framework-independent domain logic must not import Nest decorators or depend on
  HTTP/transport concerns.
- Keep types local to the owning module or class until real reuse establishes a
  boundary. Do not create shared type modules preemptively.
- REST routes carry a version prefix: `@Controller('v1/onboardings')`.
- Cross-package imports use the `@tsh/shared`, `@tsh/ddl-schema` and `@tsh/openapi`
  path aliases from `tsconfig.base.json`, never relative paths across packages.
