---
paths:
  - 'packages/engine/src/database/migrations/**/*.ts'
---

# Database migrations

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
