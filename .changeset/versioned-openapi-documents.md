---
'@tsh/engine': minor
'@tsh/openapi': minor
'@tsh/docs': minor
---

Archive each minor version's OpenAPI document and render every version in the documentation site.
`pnpm openapi:generate` copies the committed document unchanged to
`packages/shared/openapi/versions/<major.minor>/engine.openapi.json` the first time it runs after the
engine's version has moved to a new minor or major, and never rewrites an archive; a patch bump
regenerates in place. The API reference becomes a versioned Docusaurus docs instance: the current
document at `/api`, each archived one at `/api/<major.minor>`, with a version dropdown in the navbar
and a download link per version. Everything the site generates for a version is built from the
frozen file and never committed.
