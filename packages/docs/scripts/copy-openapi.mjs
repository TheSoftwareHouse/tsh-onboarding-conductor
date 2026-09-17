#!/usr/bin/env node
// Publishes the engine's committed OpenAPI document under static/openapi so the API reference can
// offer it for download from the same origin. The committed file stays the single source; this copy
// is regenerated on every build and never committed.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '..', '..', 'shared', 'openapi', 'engine.openapi.json');
const target = resolve(here, '..', 'static', 'openapi', 'engine.openapi.json');

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
process.stdout.write(`${target}\n`);
