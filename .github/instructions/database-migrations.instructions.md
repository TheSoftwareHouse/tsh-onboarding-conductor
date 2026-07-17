---
name: Database Migration Conventions
description: Conventions for TypeORM migration files in the engine package.
applyTo: packages/engine/src/database/migrations/**/*.ts
---

- Name migration files with a sequential numeric prefix and snake-case stem: `000N_description.ts`.
- Use a PascalCase migration class name ending with the migration sequence number.
- Set the migration instance `name` to exactly match the filename stem.
- Example mapping: `0001_init.ts` -> `name = '0001_init'`.
