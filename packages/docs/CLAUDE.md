# @tsh/docs

The documentation site: Docusaurus 3, classic preset, skinned with the TSH design system. Three docs
instances, each with its own sidebar under `sidebars/`:

- **Guides** (`docs/guides`, the default instance, served at `/guides`) — hand-written.
- **API** (`docs/api`, served at `/api`) — generated from
  `packages/shared/openapi/engine.openapi.json` by `docusaurus-plugin-openapi-docs`, plus three
  hand-written overview pages (`index.md`, `authentication.md`, `errors.md`).
- **Fixtures** (`docs/fixtures`, served at `/fixtures`) — generated from `workflows/fixtures` and
  `workflows/built-in` by `scripts/generate-fixtures.mjs`, plus the hand-written gallery
  `index.mdx`. An example's two files (`<name>-typed`, specialized steps; `<name>`, `custom` steps)
  share one page at `/fixtures/<name>`, specialized form first; a built-in workflow has a page per
  revision.

`docs/decisions/0016-docusaurus-documentation-site.md` records the choices; `THEME.md` here is the
design spec the stylesheet implements, and the reference when judging a visual deviation.

## Generated content is never committed

`docs/api/*.mdx`, `docs/api/*.json`, `docs/api/sidebar.ts`, `docs/fixtures/*.mdx` (except
`index.mdx`), `docs/fixtures/fixtures.manifest.json` and `static/openapi/` are written by
`pnpm run api:generate` and `pnpm run fixtures:generate` and are gitignored. `start`, `build` and
`typecheck` run the generators first, so never hand-edit a generated page: change the OpenAPI
document (through the engine's decorators) or the workflow file instead.

`sidebars/api.ts` imports the generated `docs/api/sidebar.ts`; `typecheck` therefore depends on
`api:generate` having run, and the script does that. `sidebars/fixtures.ts` reads the manifest at
config time and tolerates its absence.

## Commands

Run from the repository root: `pnpm docs:dev` (builds `@tsh/ddl-schema` first, which the fixtures
generator imports, then `docusaurus start` on <http://localhost:3030>; the engine owns 3000) and
`pnpm docs:build`. Inside the package, `pnpm serve` serves the last build on the same port.
`pnpm build` at the root builds the site after `@tsh/ddl-schema` through the workspace's
topological order.

## Theme conventions

- Everything visual comes from `src/css/custom.css` (the handoff stylesheet plus additions marked as
  such), `src/prism/tsh.ts` (code palettes), the ejected `src/theme/Footer` and the custom home
  page `src/pages/index.tsx`. Prefer CSS on Infima variables and theme class names over swizzling;
  swizzle only what `THEME.md` §5 lists.
- Non-negotiables from the design system: radius 0, no shadows, black (white in dark mode) as the
  only UI accent, headings weight 400 with `-0.04em` tracking, sentence case, no emoji, eyebrow
  labels via `.tsh-caps`. Never invent a colour outside the `--tsh-*` palette.
- `.md` pages are CommonMark (`markdown.format: 'detect'`), so braces and angle brackets are
  literal; a page that needs a component is `.mdx`.
- The fonts under `static/fonts` are the two licensed TWK Everett weights. Never add another weight;
  the stylesheet maps bold to 400 on purpose.

## Deployment

Vercel, project root directory `packages/docs`; `vercel.json` there runs the install and
`pnpm docs:build` from the repository root. The site URL comes from `DOCS_SITE_URL` or Vercel's
`VERCEL_PROJECT_PRODUCTION_URL`; a local build falls back to `http://localhost:3030`.

## Pitfalls

- The OpenAPI plugin never overwrites a file that exists: `gen-api-docs` skips an existing
  `sidebar.ts`, `*.api.mdx`, `*.tag.mdx`, `*.info.mdx` and the externalized JSON. `api:generate`
  therefore runs `api:clean` first. Drop that step and a changed document leaves the previous
  pages and a sidebar without the new operations, and `build` fails on the new tag page with
  `cant find current sidebar in context`.
- The OpenAPI plugin writes `docs/api/sidebar.ts` with the item array as its default export and
  every doc id prefixed `api/`, because it assumes a subfolder of the default instance;
  `sidebars/api.ts` unwraps the export and strips the prefix. A plugin upgrade that changes the
  generated shape breaks there first, and the unwrapping must stay bounded: the module interop can
  hand back a wrapper whose `default` is itself.
- `onBrokenLinks` throws, so a guide that links to a generated page (`/fixtures/<id>`,
  `/api/<operation>`) fails the build when the id changes. A fixture id is the workflow file stem,
  minus `-typed` for an example (`/fixtures/<name>-typed` does not exist); an operation's id is its
  kebab-cased `operationId`.
- pnpm blocks the post-install scripts of `core-js`, `@parcel/watcher` and
  `postman-code-generators` (`pnpm-workspace.yaml`); the site builds without them.
- `@docusaurus/theme-common` is a direct dependency on purpose: the generated tag pages and
  `src/theme/Footer` import it, and pnpm exposes only direct dependencies to webpack.
- `@mermaid-js/layout-elk` is installed although no diagram uses the ELK layout. The Mermaid theme
  declares it optional, but its client bundle still imports it and the build fails under pnpm when
  it is missing (facebook/docusaurus#11430). Remove it only once that issue is closed.
- The `browserslist` in `package.json` is load-bearing. Docusaurus transpiles every package whose
  path contains `docusaurus`, so the OpenAPI theme's CommonJS `lib` goes through Babel; when the
  targets include a browser that needs a helper for ES2015 syntax, Babel injects an ES-module import
  for it, webpack then treats the file as an ES module, and every API page dies at load with
  `exports is not defined` (skeleton boxes instead of the request and response panels).
- The OpenAPI plugin writes `sidebar_label: Introduction` on the info page and Docusaurus lets front
  matter win over a sidebar item's label, so `scripts/label-info-page.mjs` rewrites it as the last
  step of `api:generate`.
- Never spread a `Set` or `Map` in `src/`. The client Babel preset runs `preset-env` in `loose`
  mode, which turns `[...set]` into a one-element array, while the server bundle keeps it native;
  the page then hydrates with a mismatch, and the gallery showed every connector type as one chip.
  Use `Array.from`.

## Conventions that apply here but are owned centrally

`.claude/rules/code-design.md` and `domain-constants.md` load for the TypeScript under `src/`;
`.claude/rules/testing.md` would apply to specs, of which this package has none yet.
