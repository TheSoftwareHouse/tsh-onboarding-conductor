---
name: Engine Architecture Conventions
description: Generic architecture conventions for TypeScript files in the engine package.
applyTo: packages/engine/src/**/*.ts
---

- Engine features use vertical feature modules: primary roles (controller, module, service, repository, and co-located specs) remain at the feature root; add a service only when business logic requires it.
- Supporting artifacts belong in intent-revealing subdirectories such as `dto`, `entity`, `transport`, `errors`, or `domain`, not in per-role nested roots.
- Framework-independent domain logic must not depend on Nest decorators or HTTP/transport concerns.
- Keep types local to the owning module or class until actual reuse establishes a boundary; do not create shared type modules or interfaces preemptively.
- Keep architecture instructions generic and declarative; do not add procedural workflows or unrelated framework details.
