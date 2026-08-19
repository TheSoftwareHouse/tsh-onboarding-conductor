# Engine conventions — `packages/engine`

Scoped rules for `packages/engine/src/**/*.ts`. The repo-wide constitution in the root `CLAUDE.md`
still applies in full; this file adds the engine-specific contracts.

## Architecture

- Engine features use **vertical feature modules**: primary roles (controller, module, service,
  repository, and co-located specs) remain at the feature root; add a service only when business logic
  requires it.
- Supporting artifacts belong in intent-revealing subdirectories such as `dto`, `entity`, `transport`,
  `errors`, or `domain` — **not** in per-role nested roots.
- Framework-independent domain logic must not depend on Nest decorators or HTTP/transport concerns.
- Keep types local to the owning module or class until actual reuse establishes a boundary; do not
  create shared type modules or interfaces preemptively.
- Keep architecture instructions generic and declarative; do not add procedural workflows or unrelated
  framework details.

## HTTP errors

- There is no custom exception filter; rely on Nest's default HTTP exception handling.
- Define stable client-facing application errors as small, **feature-local classes under
  `<feature>/errors/`**, extending the appropriate Nest HTTP exception subclass.
- Each error class owns its fixed `{ code, message }` contract and should be constructed and thrown at
  call sites instead of repeating payload literals.
- Do not use a generic global error enum or map as the primary public error contract.
- Preserve the correct semantic HTTP status, distinguishing bad request, not found, and conflict
  errors.
