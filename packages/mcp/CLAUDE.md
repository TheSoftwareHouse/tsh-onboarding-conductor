# @tsh/mcp

The MCP server in front of the engine's admin API: an analyst's AI client (Claude Code, Codex)
reads onboardings, workflows and the audit trail through it, with every value masked, and two write
tools act only after a confirmation. It calls the engine over HTTP as the signed-in analyst and
nothing else.

`docs/IMPLEMENTATION.md` §14 is the as-built description (auth modes, masking classes, the tools,
limits, configuration); this file only orients within the package. The decisions are
`docs/decisions/0050`–`0053`. `docs/EXTENDING.md` has the steps to add a tool.

## Architecture

- **The engine is reached only through `EngineClient`**, over HTTP, typed from `@tsh/openapi`. No
  database, no `pg`, no import from `packages/engine`. A question the admin API cannot answer is
  computed in the tool (a date range, a timeline, an aggregate), never by widening the engine.
- Folders are vertical and named by intent: `transport/`, `auth/`, `engine/`, `masking/`,
  `classification/`, `confirmation/`, `limits/`, `audit/`, `request-context/`, `config/`, and
  `tools/<area>/` for `workflows`, `onboardings`, `analytics`, `compliance`.
- **A tool is a provider marked `@McpTool()`** that implements `ToolRegistration`. `ToolRegistry`
  discovers it; adding a tool means a class and a `providers` entry in its area module, and never an
  edit to the registry or `ToolsModule`.
- **Who is calling travels in `RequestContext`** (identity and the engine token). A tool never reads
  a header, `process.env` or the auth settings. Configuration is the one `McpConfig` class, read with
  `ConfigService.getOrThrow`.
- The parts that decide what may leave — `Masker`, `FieldClassifier`, `ConfirmationService` — are
  plain classes with no Nest decorators, wired by factories in their modules; keep them that way so
  they stay testable without a container.
- The server is stateless per request. Limits, the masked-row cache, the OBO token cache and the
  used-token set live in the process's memory and are never written to disk, so they are per
  replica.

## Pitfalls

- **Never log an argument value or a token.** The per-call audit line (`audit/tool-call-audit.ts`)
  records argument keys only, and a Nest `Logger` message must not interpolate arguments, an engine
  response body or a token either. `tool-call-audit.spec.ts` asserts it; a new log line is yours to
  check.
- **Every output passes the masker, and default deny is the rule.** Return fields you name, never an
  engine object whose type has free-form members (`metadata`, `context`, `submittedData`). Hold only
  masked rows in a cache. A new audit action family needs an entry in `masking/audit-allowlists.ts`:
  an action no list names keeps no metadata. A new tool gets a row in `TOOL_CALLS` of
  `tools/tools-masking.spec.ts` (that spec also fails when a listed tool has none); extend its
  stubbed engine with a personal-looking value where your tool could leak one.
- **A write tool is two calls.** Preview and token first, the effect only with a valid token, and
  `consume` runs before the engine write, so a write the engine then refuses needs a new preview.
  v1 has two write tools (`0051`); a third is a decision, not an addition.
- **`POST /mcp` checks `Host` and `Origin` against `MCP_PUBLIC_URL` and localhost.** This is the
  DNS-rebinding protection: a request whose `Host` or `Origin` names any other host is refused,
  so a client reaching the server under a different name needs that name in `MCP_PUBLIC_URL`.
- **A tool's `description` is the model's only documentation of it.** State its limits and the
  neighbouring tool. Name every cap as a constant and report `truncated` when one cut the answer.
- **`humanizeKey` in `masking/csv-columns.ts` is a copy** of the engine's in
  `packages/engine/src/onboardings/domain/onboardings-csv.ts`, because a CSV header is the only link
  between a column and its field. When the engine changes the derivation, change this one.
- **The audit action lists mirror `packages/engine/src/audit/audit.types.ts`**: `ACCESS_ACTIONS` and
  `CONFIGURATION_ACTIONS` in `tools/compliance/compliance.constants.ts`, the action maps of
  `connector_health` and the funnel, and the allowlists. The engine filters the audit by exact action
  name, so an action added there is invisible here until it is added by hand.
- **`jose` ships ES modules only.** `jest.config.cjs` transpiles it (a `[tj]s` ts-jest transform and a
  `transformIgnorePatterns` exception for that one package) and `tsconfig.spec.json` sets `allowJs`.
  Removing either breaks every spec that imports the auth code.
- **`nest build` runs with `incremental: false`** (`tsconfig.build.json`). With Nest's
  `deleteOutDir`, a stale `tsbuildinfo` produced an incomplete `dist/` and a zero exit code.
- **Specs that boot the app set the environment first and import `AppModule` after**
  (`await import('../app.module')`): `ConfigModule.forRoot` validates `process.env` the moment the
  module is imported. Stub the engine with `jest.spyOn(global, 'fetch')` or a stubbed `EngineClient`.
- **`@tsh/openapi` is types only here**, imported with `import type` and erased at build; the
  Dockerfile copies `packages/shared/openapi/src` into its build stage for that. A runtime import of
  it fails the image. After an engine route or DTO change, `pnpm openapi:generate` rewrites the types,
  and a stale one shows up as a `typecheck` error in this package.
- **Auth off is a local switch.** `MCP_AUTH_ENABLED=false` is refused under `NODE_ENV=production`;
  the masking key in `.env.dist` and Compose is a development key published in this repository.
- **The sign-in relay is the authorization server, and Entra rejects `resource`.** With auth on,
  `auth/authorization-server/` serves `/oauth/authorize`, `/oauth/token`, `/oauth/register` and the RFC
  8414 metadata (`0054`), and the protected-resource metadata names `MCP_PUBLIC_URL`, not the tenant.
  The relay forwards only the listed parameters and drops `resource`, which makes Entra fail with
  `AADSTS9010010`: never forward a request body or query through. The authorize redirect host is fixed,
  and the token route never logs a body, code, verifier or token. The issuer is `MCP_PUBLIC_URL`, so it
  must be HTTPS outside localhost; clients get `MCP_PUBLIC_CLIENT_ID`, which defaults to
  `MCP_AZURE_CLIENT_ID`. Every route answers 404 with auth off.
- **The plugin's golden sets need this server running and the seeder run** (`pnpm stack:mcp:up`,
  `pnpm onboardings:seed`); the sets live under `plugins/conductor-analyst/skills/*/evals/`. A tool
  you rename or reshape changes the tool names those sets check with `mcp-tool-called`, and the
  plugin agent's `tools` list.

## Commands

- `pnpm --filter @tsh/mcp test -- src/<path>.spec.ts` for one spec; the package needs no stack.
- `pnpm --filter @tsh/mcp start:dev` runs it on the host against an engine at
  `MCP_ENGINE_BASE_URL` (from `.env`); `pnpm stack:mcp:up` runs it in Compose on port 3100.
- `pnpm mcp:inspect` opens the Inspector's web UI. For a scriptable list of the tools run
  `pnpm --filter @tsh/mcp exec mcp-inspector --cli http://localhost:3100/mcp --transport http --method tools/list`.
