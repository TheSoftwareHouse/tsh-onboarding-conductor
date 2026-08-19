---
description: Create the next sequential TypeORM migration with a correct 13-digit name suffix
argument-hint: <snake_case_description>
---

Create a new TypeORM migration for: **$ARGUMENTS**

Steps:

1. List `packages/engine/src/database/migrations/` and find the highest existing numeric prefix. The
   new file takes the next number, zero-padded to four digits.
2. File name: `<NNNN>_<snake_case_description>.ts`.
3. Class name: PascalCase description followed by the sequence number, e.g.
   `CreateOnboardings0002`.
4. Set the instance `name` to `<filename_stem>_<13-digit-timestamp>`. TypeORM reads the **final 13
   characters** as the timestamp, so it must end in exactly 13 digits and must sort after the previous
   migration's timestamp. Verify the digit count by reading the string back, and check the tail of the
   most recent migration to confirm ordering.
5. Implement both `up()` and `down()`. `down()` must actually reverse `up()`.
6. Literal SQL values are acceptable here — migrations are one of the few places the
   domain-constants rule allows them.
7. Read the two or three most recent migrations first and match their style (query runner usage,
   quoting, index and constraint naming).

Then update `docs/IMPLEMENTATION.md` §9 (new table, column, or migration) in the same change, and run
`pnpm format:fix`, `pnpm lint` and `pnpm typecheck`.
