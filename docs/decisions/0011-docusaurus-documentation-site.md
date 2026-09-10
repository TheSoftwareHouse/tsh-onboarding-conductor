# 0011. The documentation site is a Docusaurus package that generates its API and fixture pages at build

- **Status:** Proposed
- **Date:** 2026-09-10
- **Tags:** documentation, docusaurus, openapi, fixtures, deployment
- **Supersedes:** —
- **Superseded by:** —

## Decision

Reader-facing documentation is a Docusaurus 3 site in `packages/docs` (`@tsh/docs`), skinned with
the TSH design system, with three docs instances: hand-written guides, an API reference and a
fixtures gallery. The API reference is generated from `packages/shared/openapi/engine.openapi.json`
by `docusaurus-plugin-openapi-docs`; the fixtures gallery is generated from the workflow files in
`workflows/fixtures` and `workflows/built-in` by a script in the package. Neither generated output
is committed: `build`, `start` and `typecheck` regenerate it first, and `.gitignore` excludes it.
Search is the local search plugin, not Algolia. The site deploys to Vercel from `packages/docs`.

Out of scope: moving `docs/IMPLEMENTATION.md` and `docs/EXTENDING.md` into the site. They stay the
as-built specification and the extension reference; the guides link to them.

## Context

Decision 0010 made the engine's HTTP contract a committed OpenAPI document so a documentation site
could render it. The design handoff for that site arrived as a Docusaurus theme: a stylesheet
mapping the TSH tokens onto Infima, licensed fonts, a swizzle list and a home page specification.
Three constraints decided the shape:

- The API reference and the fixture pages have sources of truth elsewhere in the repository. A
  committed copy of either would be a second declaration that drifts; the spec is already held
  equal to the code by a unit test, and the workflow files are what the engine loads.
- The site must join the monorepo's existing fan-out (`pnpm build`, `lint`, `typecheck`) and the
  engine image's dependency stage, or it silently falls out of CI.
- Hosting is Vercel, and the repository is private today, which rules out GitHub Pages without an
  Enterprise plan and rules out Algolia DocSearch's free tier, which requires a public site.

## Alternatives

| Option                                                    | Why not                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Committing the generated API and fixture pages            | A second copy of the spec and of each workflow, with nothing to notice when either source moves              |
| Redoc or Scalar embedded in a page                        | One monolithic reference page; the design calls for one page per route with the sidebar grouped by audience  |
| Algolia DocSearch                                         | Needs a public site and an application; the stylesheet's DocSearch theming is kept for the day that changes  |
| GitHub Pages                                              | Not available on a private repository without an Enterprise plan                                             |
| The engine serving the site, as it serves the admin panel | Couples documentation releases to engine releases and adds a static bundle to every engine image             |
| Moving the implementation spec into the site now          | Twenty-odd pages of content work with the spec as the source meanwhile; the guides ship first and link to it |

## Consequences

- `pnpm build` and `pnpm typecheck` grow by the site's generation and build. The site build is the
  slowest step in the fan-out.
- A change to the OpenAPI document or to a workflow file shows up in the site on the next build
  with no further action. A broken link into a generated page fails the build, since
  `onBrokenLinks` throws.
- The API reference's ids and sidebar come from the plugin, which assumes it writes into a subfolder
  of the default docs instance; `sidebars/api.ts` strips that prefix. A plugin upgrade that changes
  the generated shape surfaces there first.
- The licensed TWK Everett fonts live in the package's static folder and are published with the
  site. That is acceptable under the licence held; check it before the repository goes public.
- The fixtures gallery depends on `@tsh/ddl-schema`'s build output, so the site is built after it in
  the fan-out and `pnpm docs:dev` builds it first.

Reversing this is cheap: the package can be removed without touching the engine or the spec.
