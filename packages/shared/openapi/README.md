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

## Archived versions

`versions/<major.minor>/engine.openapi.json` is the frozen document of an earlier minor version:
the last document that minor produced. The generator writes it the first time it runs after the
engine's `package.json` version has moved to a new minor or major, and never rewrites it — a patch
bump regenerates `engine.openapi.json` in place and archives nothing. The documentation site renders
every archived document as a version of the API reference. Do not edit or remove an archive; the
same spec checks each against the folder that names it.
