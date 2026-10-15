# 0045. Each minor version's OpenAPI document is archived by the generator and rendered by the site

- **Status:** Accepted
- **Date:** 2026-10-07
- **Tags:** api, openapi, documentation, docusaurus, versioning
- **Supersedes:** —
- **Superseded by:** —

## Decision

The committed OpenAPI document (`packages/shared/openapi/engine.openapi.json`, decision 0015) stays
the current contract. The first time `pnpm openapi:generate` runs after the engine's
`package.json` version has moved to a new minor or major, it copies the committed document
unchanged to `packages/shared/openapi/versions/<major.minor>/engine.openapi.json` before
regenerating it. That copy is the frozen record of the superseded minor — the last document that
minor produced — and is never rewritten: the generator refuses when the folder already exists, and
refuses when the engine's version is below the committed document's. A patch bump regenerates the
committed document in place and archives nothing. A unit test holds every archived document to the
folder that names it.

The documentation site renders the archive with Docusaurus' own docs versioning on the `api`
instance. The current document is the `current` version at `/api`; each archived document is a
version at `/api/<major.minor>`, generated at build time from its frozen file by an OpenAPI plugin
entry of its own, with its sidebar written as the JSON Docusaurus expects and the three hand-written
overview pages copied in with that version's download link. The versions file, the versioned pages
and sidebars and the published copies of the documents are generated on every build and never
committed, as decision 0016 already says of the current version's pages. A `docsVersionDropdown`
in the navbar switches between versions, and the navbar's API entry is a `doc` item of the `api`
instance rather than a link to `/api`, so it opens the version the reader last chose instead of
always the current one. Every page of an archived version carries Docusaurus' version banner with
the project's own wording (`packages/docs/i18n/en/code.json`): which version the pages describe, that
the Guides describe the current engine, and a link to the same page in the current version. The local
search plugin indexes each version under its own route.

Out of scope: a release command around `changeset version`. Bumping `packages/engine/package.json`
and running `pnpm openapi:generate` is the whole procedure, and the drift test already forces the
second step because `info.version` is part of the compared document.

## Context

The site is deployed without an engine beside it, so everything it renders has to come from the
repository — which decision 0016 already arranged, since the API reference is generated from the
committed document and the document is published with the bundle for download. What was missing
was history: every package is `0.1.0`, no version had ever been cut, and when the version moved the
previous document would simply be overwritten. Clients integrating against an older engine need the
contract of the version they run, and the site is where they read it.

Three constraints decided the shape:

- The committed document is already the single source held equal to the code; an archive must be a
  copy of it taken at a well-defined moment, not a second generation path. The moment the engine's
  version leaves a minor is the only point at which "the last document of that minor" exists, and
  the generator is already the command that runs there.
- The site's generated output is not committed (0016). Versioning the API reference by committing
  Docusaurus' `versioned_docs` snapshots would commit hundreds of generated MDX files per version.
- Docusaurus' versioning expects the versions file and a folder per version to exist before any of
  its commands run, including the OpenAPI plugin's own `gen-api-docs` and `clean-api-docs`; the
  plugin, for its part, prefixes generated sidebar ids with the output folder's name, which for a
  `version-X` folder is exactly the legacy prefix Docusaurus 3 rejects, and derives the route pages'
  `info_path` from the same folder, wrongly for both layouts. Generation therefore needs a step
  before the plugin and a step after it.

## Alternatives

| Option                                             | Why not                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The OpenAPI plugin's own `versions` option         | Its only selector is a small dropdown rendered on the info page; no navbar item, no per-version search index, no link from a guide to a version                                                                                                                                                    |
| Committing Docusaurus' versioned MDX snapshots     | Hundreds of generated files per version in the repository, the second copy decision 0016 exists to avoid                                                                                                                                                                                           |
| A separate `pnpm openapi:archive` command          | A step that can be forgotten; the generator already runs at the bump because the drift test fails on `info.version` alone                                                                                                                                                                          |
| Archiving every patch version                      | One folder per release for documents that mostly differ in `info.version`; the user asked for minors and majors only                                                                                                                                                                               |
| Reading the archive from git history at build time | Ties the build to the repository's history and tags, of which there are none, and makes the archive invisible in the tree                                                                                                                                                                          |
| A version note on the overview pages only          | Rejected on review: the generated endpoint pages, which is where a reader lands from search, said nothing about their version. Docusaurus' banner reaches every page; its stock "no longer maintained" wording is replaced, because a frozen contract is still the contract of that engine version |
| Versioning the Guides alongside the API            | Deferred, see Consequences: hand-written pages would be snapshotted into committed `versioned_docs/` at every minor bump, and one dropdown would have to drive two docs instances                                                                                                                  |

## Consequences

- `pnpm openapi:generate` gains two refusals: an engine version below the committed document's, and
  an archive folder that already exists. Both mean the version in `package.json` and the committed
  document disagree about history, and both are resolved by hand.
- The docs build grows by one generation pass per archived version. The current cost is one pass; it
  grows linearly with the number of minors the project has shipped.
- Scripts under `packages/docs/scripts` import TypeScript modules through Node 24's type stripping,
  so the shared modules (`openapi-versions.ts`, `sidebars/api-items.ts`) keep to erasable
  TypeScript. The Docusaurus config loads the same modules through its own loader.
- A hand-written overview page is the current version's text copied into each archived version. A
  statement that stops being true for an older version has to be worded for both or moved into the
  generated pages.
- With no archive the site is exactly as before, apart from the navbar entry, which Docusaurus
  renders as a plain link carrying the current version's label until a second version exists.
- The Guides stay unversioned and describe the current engine, which the banner on an archived API
  version says. Versioning them is a follow-up, not a reversal of this record: snapshot `docs/guides`
  with `docusaurus docs:version <major.minor>` in the same step that archives the document, commit the
  snapshots (they are hand-written sources, not generated output), and replace the stock dropdown with
  a navbar item that saves the preferred version of both docs instances, so that switching sections
  keeps the version. Fixtures would stay unversioned, being rendered from the workflow files.
- An archived version's route ends in a dotted segment (`/api/0.1/`). `docusaurus serve` reads that
  as a file name with an extension and answers 404 for the version's overview page on a direct
  request or reload, although the page is built and every other route of the version works; the
  deployed site is served by Vercel, which has not shown the problem. A prefix such as `v0.1` would
  not help, since the segment would still be dotted.

Reversing this is cheap: delete the `versions/` folder and the version-aware steps, and the site is
back to one version. The archived documents remain readable JSON wherever they are kept.
