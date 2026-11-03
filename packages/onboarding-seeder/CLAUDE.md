# @tsh/onboarding-seeder

A CLI that builds a deterministic population of synthetic onboardings on a running stack by driving
the engine's public API, and writes `out/manifest.json` saying what each onboarding demonstrates.
The MCP server and the analyst skills' golden sets use that population. `pnpm onboardings:seed` runs
it; `docs/IMPLEMENTATION.md` §15 is the as-built description and the workflow it runs is
`workflows/fixtures/analyst-investigation.workflow.json`.

## Pitfalls

- **The public API is the way in.** Every transition, audit row and score must come from the engine
  itself. The only database access is the read-only provider-reference lookup
  (`provider/provider-reference-reader.ts`) and the optional timestamp spread
  (`spread/timestamp-spread.ts`); both call `assertLocalDatabaseHost` first and refuse any host but
  `localhost`, `127.0.0.1` and `postgres`. Never write to the database to make a scenario reachable;
  if one cannot be reached through the API, that is a finding to report.
- **Determinism is the product.** All randomness comes from `@faker-js/faker` seeded by `--seed`, and
  birth dates are drawn against a fixed reference date, not today; the spread's offsets come from a
  hash of the seed and the scenario key. Nothing in data generation may call `Date.now()` or
  `Math.random()`. `scenario-catalogue.spec.ts` pins "same seed, same plan".
- **Scenario keys and `explanation` texts are read elsewhere.** The plugin's golden sets name a
  scenario as `{{manifest:<family>-<nn>}}` and compare the answer with
  `{{manifest:<key>.explanation}}`; renaming a family or rewording an explanation changes what those
  cases measure. Counts per family are fixed except `approved` (`--count`).
- **`src/workflow/analyst-investigation.ts` and `risk-assessment.ts` restate the fixture workflow**:
  its step names, the risk points and the rejection threshold, the provider key and the question
  values. A change to the workflow is a change there, and the other way round.
- **No manifest on a mismatch.** After every scenario the run reads the onboarding back through
  `/state` and compares it with the plan; any difference throws, naming the scenario, and nothing is
  written. Keep it that way: the manifest must never describe a population the run did not build.
- **It adds, never deletes.** A rerun creates another population; `pnpm stack:reset` starts clean.
  `--spread-days` rewrites `onboardings` and `audit_log` timestamps in the database and runs last.
- **It needs the whole stack up**: the engine, MailHog (the email codes), Postgres and the object
  store (the upload URL is signed for the Compose-internal host and rewritten to `--storage-url`).
  `DATABASE_URL` is always required.
- **Synthetic data only.** Emails are `@example.com` and phone numbers sit in UK Ofcom's reserved
  drama range. Keep it that way.
- **`@faker-js/faker` ships ES modules only**: `jest.config.cjs` lets ts-jest transpile it and
  `tsconfig.spec.json` sets `allowJs`, as in `@tsh/mcp`.
- The engine client is typed from `@tsh/openapi` (`import type` only); after a route change
  `pnpm openapi:generate` regenerates it.

## Commands

- `pnpm onboardings:seed --help` prints the options.
- `pnpm --filter @tsh/onboarding-seeder test -- src/<path>.spec.ts` runs one spec, with no stack.
