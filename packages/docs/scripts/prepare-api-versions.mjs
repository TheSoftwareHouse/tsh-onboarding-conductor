#!/usr/bin/env node
// Registers every archived OpenAPI document as a Docusaurus version of the `api` docs instance
// before any `docusaurus` command runs: `api_versions.json` names the versions, newest first, and
// each needs its `api_versioned_docs/version-<X>/` folder to exist, or Docusaurus refuses to load —
// `clean-api-docs` and `gen-api-docs` included, since they initialise the plugins too. Everything
// written here is regenerated on every build and never committed; the previous output is removed
// first so a version that disappeared from the archive disappears from the site.
//
// Usage: node scripts/prepare-api-versions.mjs [--clean]

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import {
  API_VERSIONED_DOCS_DIR,
  API_VERSIONED_SIDEBARS_DIR,
  API_VERSIONS_FILE,
  listArchivedVersions,
} from '../openapi-versions.ts';

const cleanOnly = process.argv.includes('--clean');

for (const path of [API_VERSIONED_DOCS_DIR, API_VERSIONED_SIDEBARS_DIR, API_VERSIONS_FILE]) {
  rmSync(path, { recursive: true, force: true });
}

if (cleanOnly) {
  process.exit(0);
}

const archived = listArchivedVersions();

if (archived.length === 0) {
  console.log('No archived OpenAPI documents; the API reference has one version.');
  process.exit(0);
}

for (const { docsDir } of archived) {
  mkdirSync(docsDir, { recursive: true });
}

writeFileSync(API_VERSIONS_FILE, `${JSON.stringify(archived.map(({ version }) => version))}\n`);
console.log(`${API_VERSIONS_FILE}: ${archived.map(({ version }) => version).join(', ')}`);
