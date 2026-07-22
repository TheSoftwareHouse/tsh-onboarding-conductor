---
name: Domain Constants Conventions
description: Conventions for domain values shared across the packages in the monorepo.
applyTo: packages/**/*.ts
---

- Represent domain values used in multiple places (event types, statuses, state identifiers, etc.) as a single named enum, const, or type contract. Do not repeat magic strings across the codebase.
- Keep SQL migrations, external wire contracts, and tests verifying raw payloads as the only places where literal values are acceptable. Even in tests, prefer reusing the constant when readability is not reduced.
- Do not duplicate existing instructions or constants; extend the canonical contract instead.
