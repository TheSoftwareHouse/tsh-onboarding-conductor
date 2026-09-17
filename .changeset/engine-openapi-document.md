---
'@tsh/engine': minor
'@tsh/openapi': minor
---

Publish the engine's HTTP contract as an OpenAPI 3.1 document generated from its route and DTO
decorators. The document is committed at `packages/shared/openapi/engine.openapi.json`, regenerated
with `pnpm openapi:generate`, served by a running engine at `GET /v1/openapi.json`, and `pnpm test`
fails when the committed file no longer matches the code. Provider-callback refusals that were
inline `BadRequestException` payloads are now exception classes with the same codes.
