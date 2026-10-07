#!/usr/bin/env node
// Publishes the engine's OpenAPI documents under static/openapi so each version of the API reference
// can offer its own for download from the same origin: the current document at
// /openapi/engine.openapi.json and each archived one at /openapi/<major.minor>/engine.openapi.json.
// The committed files stay the single source; these copies are regenerated on every build and never
// committed.
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  CURRENT_DOCUMENT_FILE,
  listArchivedVersions,
  OPENAPI_DOCUMENT_NAME,
  STATIC_OPENAPI_DIR,
} from '../openapi-versions.ts';

rmSync(STATIC_OPENAPI_DIR, { recursive: true, force: true });

const copies = [
  { source: CURRENT_DOCUMENT_FILE, target: join(STATIC_OPENAPI_DIR, OPENAPI_DOCUMENT_NAME) },
  ...listArchivedVersions().map(({ version, specFile }) => ({
    source: specFile,
    target: join(STATIC_OPENAPI_DIR, version, OPENAPI_DOCUMENT_NAME),
  })),
];

for (const { source, target } of copies) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  process.stdout.write(`${target}\n`);
}
