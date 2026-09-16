---
paths:
  - 'packages/engine/src/**/*.controller.ts'
  - 'packages/engine/src/**/dto/*.ts'
  - 'packages/engine/src/**/errors/*.exception.ts'
  - 'packages/engine/src/openapi/**/*.ts'
---

# API documentation

The engine's HTTP contract is generated from these files into
`packages/shared/openapi/engine.openapi.json`, and `src/openapi/openapi-document.spec.ts` fails
while that file disagrees with the code. After changing a route, a DTO or an error contract, run
`pnpm openapi:generate` and commit the result. Never edit the JSON by hand; Prettier ignores it on
purpose.

- **Every handler** carries `@ApiOperation` with a unique camelCase `operationId` and a `summary`;
  exactly one tag from `API_TAGS` (`src/openapi/openapi.constants.ts`), on the method or its
  controller; one success response (`@ApiOkResponse`, `@ApiCreatedResponse` or
  `@ApiNoContentResponse`) with a `description`; `@ApiParam` for each path parameter; and
  `@ApiErrorResponses(...)` naming every exception class the handler can let through, plus
  `VALIDATION_ERROR` when it takes a validated body or query. Uncaught status codes are not
  documented by guessing — trace the service call to the classes it throws. If that trace reaches
  something the handler can let through that is _not_ an `HttpException` — a `*.error.ts` domain
  error a service re-throws, as the connector executor does on `propagate` — the route also carries
  `frameworkError(500, …)`: Nest answers those with its own envelope, and a coded `500` alone would
  promise a `code` the route does not always send.
- **Admin handlers** are marked `@AdminRoute()` (`src/auth/admin-route.decorator.ts`), never a bare
  `@UseGuards(AzureJwtGuard)` and never `@ApiBearerAuth` by hand: the decorator applies the guard
  and documents it in one step so the two cannot disagree.
- **Request DTOs**: every property carries `@ApiProperty` or `@ApiPropertyOptional` beside its
  class-validator decorators, with a `description`, and an `example` where a real value helps.
- **Response shapes** are classes under the feature's `dto/`, named `*ResponseDto`, every property
  decorated: `type: String, nullable: true` for a nullable primitive, `type: () => Class` for a
  nested object, `isArray: true` for an array. Domain types (`StepDescription`) stay plain and the
  DTO class mirrors them. The shared enums are spread from `src/openapi/api-enums.ts`
  (`...WORKFLOW_STATUS_ENUM`), never redeclared with their own `enumName`.
- **A body with no fixed shape** is documented with `@ApiBody({ description, schema })` that says
  where the shape comes from: the step's `schema`, the adapter's declared settings keys, or a
  `$ref` to the embedded workflow schema (`schemaRef(WORKFLOW_DOCUMENT_SCHEMA)`).
- **Exception classes** carry `static readonly apiDescription`: one sentence on what the refusal
  means and which detail properties the payload adds. A client-facing refusal is always a class in
  `errors/`; an inline `new BadRequestException({ code })` cannot be documented.
