# @tsh/openapi

The engine's OpenAPI document, `engine.openapi.json`, generated from the engine's own route and
DTO decorators. It is the input the documentation site builds from and the file a client generator
reads.

Do not edit it by hand. Regenerate it after changing a route, a DTO or an error contract:

```bash
pnpm openapi:generate
```

`packages/engine/src/openapi/openapi-document.spec.ts` fails when the committed file no longer
matches the code, so a stale document cannot merge. A running engine serves the same document at
`GET /v1/openapi.json`.
