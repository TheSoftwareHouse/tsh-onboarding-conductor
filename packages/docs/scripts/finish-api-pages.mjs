#!/usr/bin/env node
// Finishes what `docusaurus gen-api-docs all` wrote, for the current version in docs/api and for
// each archived version in api_versioned_docs/version-<X>/. Runs last in `api:generate`.
//
// In every output directory:
// - The plugin hardcodes `sidebar_label: Introduction` on the info page, and Docusaurus lets a doc's
//   front matter win over the label its sidebar entry carries, so the front matter is rewritten.
// - Every route page carries `info_path`, the link the Authorization panel follows to the info
//   page. The plugin derives it from the output directory and gets it wrong for both layouts
//   (`api//…` today, `api/version-X/…` for an archive), so it is rewritten to the real route.
//
// For an archived version only:
// - The three hand-written overview pages are copied in from docs/api, the download link pointed at
//   that version's copy of the document and a note added saying which version the pages describe.
// - The plugin's `sidebar.ts` is turned into the versioned sidebar Docusaurus expects as JSON, through
//   the same builder the current version's sidebars/api.ts uses. Node strips the types itself.
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/finish-api-pages.mjs

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { API_DOCS_DIR, listArchivedVersions } from '../openapi-versions.ts';
import { buildApiSidebar } from '../sidebars/api-items.ts';

const INFO_PAGE_LABEL = 'From the OpenAPI document';
const OVERVIEW_PAGES = ['index.md', 'authentication.md', 'errors.md'];
const CURRENT_DOWNLOAD_LINK = 'pathname:///openapi/engine.openapi.json';

/** The info page's id is its file stem; the generator names it after the document's title. */
function findInfoDocId(dir) {
  const infoPages = readdirSync(dir).filter((name) => name.endsWith('.info.mdx'));

  if (infoPages.length !== 1) {
    throw new Error(
      `Expected one *.info.mdx under ${dir}, found ${infoPages.length}; run gen-api-docs first`,
    );
  }

  return basename(infoPages[0], '.info.mdx');
}

function rewriteFrontMatter(file, key, value) {
  const source = readFileSync(file, 'utf8');
  const pattern = new RegExp(`^${key}: .*$`, 'm');

  if (!pattern.test(source)) {
    throw new Error(`${file} has no "${key}" front matter to rewrite`);
  }

  writeFileSync(file, source.replace(pattern, `${key}: ${value}`));
}

/** Labels the info page and points every route page's Authorization link at it. */
function finishGeneratedPages(dir, routeBase) {
  const infoDocId = findInfoDocId(dir);

  rewriteFrontMatter(join(dir, `${infoDocId}.info.mdx`), 'sidebar_label', INFO_PAGE_LABEL);

  for (const name of readdirSync(dir).filter((entry) => entry.endsWith('.api.mdx'))) {
    rewriteFrontMatter(join(dir, name), 'info_path', `${routeBase}/${infoDocId}`);
  }

  return infoDocId;
}

function copyOverviewPages({ version, docsDir, downloadUrl }) {
  const note = [
    ':::info Older version',
    `These pages describe version ${version} of the engine's API. [The current version](/api/) is where new routes and fields appear.`,
    ':::',
    '',
  ].join('\n');

  for (const name of OVERVIEW_PAGES) {
    const source = readFileSync(join(API_DOCS_DIR, name), 'utf8');
    const frontMatterEnd = source.indexOf('\n---\n', source.indexOf('---\n') + 1);

    if (frontMatterEnd === -1) {
      throw new Error(`${name} has no front matter block`);
    }

    const head = source.slice(0, frontMatterEnd + '\n---\n'.length);
    const body = source
      .slice(head.length)
      .replaceAll(CURRENT_DOWNLOAD_LINK, `pathname://${downloadUrl}`);

    writeFileSync(join(docsDir, name), `${head}\n${note}${body}`);
  }
}

async function writeVersionedSidebar({ version, docsDir, sidebarFile }, infoDocId) {
  const generated = await import(pathToFileURL(join(docsDir, 'sidebar.ts')).href);
  const items = buildApiSidebar(generated.default, `version-${version}/`, infoDocId);

  mkdirSync(dirname(sidebarFile), { recursive: true });
  writeFileSync(sidebarFile, `${JSON.stringify({ api: items }, null, 2)}\n`);
}

finishGeneratedPages(API_DOCS_DIR, 'api');
console.log(`${API_DOCS_DIR}: current version finished`);

for (const archived of listArchivedVersions()) {
  const infoDocId = finishGeneratedPages(archived.docsDir, `api/${archived.version}`);

  copyOverviewPages(archived);
  await writeVersionedSidebar(archived, infoDocId);
  console.log(`${archived.docsDir}: version ${archived.version} finished`);
}
