# 0014. The OpenAPI document is generated from the engine's decorators and committed

- **Status:** Proposed
- **Date:** 2026-09-10
- **Tags:** api, openapi, documentation, engine
- **Supersedes:** —
- **Superseded by:** —

## Decision

The engine's HTTP contract is published as an OpenAPI 3.1 document generated from explicit
`@nestjs/swagger` decorators on its controllers and DTOs, committed at
`packages/shared/openapi/engine.openapi.json`, and held equal to the code by a unit test.
`pnpm openapi:generate` rewrites the file; `openapi-document.spec.ts` fails when the committed file
and the decorators disagree. A running engine serves the same document at `GET /v1/openapi.json`
and serves no Swagger UI.

Four choices shape it:

**Decorators are written by hand, not inferred by the compiler plugin.** Every response shape is a
class carrying `@ApiProperty`; every route carries `@ApiOperation`, a success response and its
error responses. The `@nestjs/swagger` CLI plugin is not used.

**Errors are documented from the exception classes themselves.** `ApiErrorResponses(...)` takes the
exception classes a route can throw, constructs each once and reads its status and `code` off the
instance, so the document cannot state a status or code the class does not produce. A class's
one-line meaning is its `static apiDescription`.

**The guard and its documentation are one decorator.** `AdminRoute()` applies `AzureJwtGuard` and
declares the bearer requirement with its `401`/`403`/`503` responses, so a route cannot be guarded
without being documented as such, or the reverse.

**The document is 3.1 and embeds the DDL's schemas.** The workflow and node-graph JSON Schemas the
DDL package derives in memory are mounted as components verbatim, so the compile route's body is
described exactly rather than as "an object".

Out of scope: the documentation site that renders the document, and any generated client.

## Context

A reader-facing documentation site is the next step and needs a specification file at its build
time. The only account of the API was the route table in `docs/IMPLEMENTATION.md`, which is prose
and says nothing about response shapes or error codes. Three constraints decided the mechanism:

- The document must be complete under every way the code runs. `start:dev` runs the engine under
  ts-node and the unit suite runs under ts-jest; neither runs Nest's compiler plugin, so a document
  that is complete only in `nest build` output would be incomplete exactly where developers look.
- Regenerating and checking the document must not need Docker. TypeORM's data source initialises
  when the module graph is compiled, so building the document from `AppModule` would otherwise open
  a database connection; a check that needs infrastructure runs only in the e2e stage and a stale
  document is discovered last.
- Response types were mostly TypeScript type aliases and untyped handler returns, which no
  reflection can see. Turning them into classes was unavoidable under any code-first approach.

The workflow schemas use `if`/`then`, `const` and local `$ref`s. OpenAPI 3.0's schema subset does
not carry them; 3.1 adopts JSON Schema 2020-12, whose keywords overlap draft-07's for everything
these schemas use, so they embed with only their `definitions` relocated.

## Alternatives

| Option                                                  | Why not                                                                                                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hand-written OpenAPI YAML                               | Drifts from the code with nothing to notice; `docs/IMPLEMENTATION.md` already forbids claims a reader cannot check against the code                                                  |
| `@nestjs/swagger` CLI plugin with comment introspection | Runs only under `nest build`; `start:dev` and jest would build an incomplete document unless ts-jest gets a custom AST transformer, and the compiled metadata is invisible in review |
| Plugin for the bulk, decorators for the rest            | Two mechanisms with two failure modes producing one artefact                                                                                                                         |
| OpenAPI 3.0                                             | Cannot embed the workflow schemas; the compile body would be documented as a free-form object                                                                                        |
| Swagger UI served by the engine                         | Another unauthenticated page listing the admin routes and 11 MB in the image, when the documentation site is the reader-facing UI                                                    |
| Generating the document only in the e2e suite           | Needs the Docker stack to regenerate locally and pushes drift detection to the slowest CI stage                                                                                      |
| A static error catalogue for the documentation          | A second declaration of every code and status beside the exception class, which the engine's error convention exists to avoid                                                        |

## Consequences

- A change to a route, a DTO or an error contract needs `pnpm openapi:generate` in the same commit,
  or `pnpm test` fails. Reviews gain a generated JSON diff; `.prettierignore` keeps Prettier off it
  so the generator's rendering is the only one.
- A new response property without `@ApiProperty` is absent from the document, and no test can see
  a property that was never declared. Completeness of the property list rests on review; the
  completeness test covers what is declared.
- Exception classes are constructed at decoration time. A future class whose constructor has side
  effects, or whose status depends on its arguments, must be listed through the explicit
  `{ exception, args }` form, as `CallbackSignatureInvalidException` is.
- Response types that were aliases are now classes under each feature's `dto/`, so a service that
  returned an anonymous object now names its shape. Domain types such as `StepDescription` stay
  plain, and the DTO classes mirror them structurally.
- The document is built at every bootstrap, including `worker-only` mode where nothing serves it.
  Measured in milliseconds; accepted for the simplicity of one wiring.
- Embedding draft-07 schemas under 3.1 relies on keyword overlap. A DDL schema that starts using a
  keyword 2020-12 renamed (`dependencies`, tuple-form `items`) would need translation in
  `embedJsonSchemaDocument`; the unit test on the real schemas is where that would surface.

Reversing this is cheap in one direction and expensive in the other: the runtime route and the
generator can be dropped without touching behaviour, but the decorators are spread across every
controller and DTO, and removing them is a large mechanical change with nothing gained.
