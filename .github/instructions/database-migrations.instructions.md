---
name: Database Migration Conventions
description: Conventions for TypeORM migration files in the engine package.
applyTo: packages/engine/src/database/migrations/**/*.ts
---

- Name migration files with a sequential numeric prefix and snake-case stem: `000N_description.ts`.
- Use a PascalCase migration class name ending with the migration sequence number.
- Set the migration instance `name` to `<filename_stem>_<13-digit-javascript-timestamp>`. TypeORM parses the final 13 characters of the migration name as a timestamp, so the name must end with exactly 13 digits.
- Example mapping: `0002_create_onboardings.ts` -> `name = '0002_create_onboardings_1735689600000'`.
