import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildOpenApiDocument, readEngineVersion } from './openapi-document';
import { createOpenApiApp } from './testing/create-openapi-app';
import {
  archivedOpenApiDocumentFile,
  compareMinorVersions,
  ENGINE_OPENAPI_DOCUMENT_FILE,
  minorVersionOf,
  renderOpenApiDocument,
} from './testing/openapi-artifact';

// Writes the OpenAPI document the engine's decorators describe to the committed artefact.
// `openapi-document.spec.ts` fails whenever that file no longer matches the code, so this is what
// to run after changing a route, a DTO or an error contract.
//
// The committed document is also the archive's source. While the engine's `major.minor` equals the
// committed document's, the file is rewritten in place — a patch bump included. Once the engine's
// version has moved past it, the committed document is first copied unchanged to
// `versions/<major.minor>/engine.openapi.json`, the frozen record of that minor, and only then
// replaced; the documentation site renders every archived document beside the current one. An
// archive is written once: finding one already there means the version was cut earlier, and a
// version below the committed one means the manifest went backwards. Both stop the run.
//
// Usage: pnpm openapi:generate

function archiveSupersededDocument(engineVersion: string): string | undefined {
  if (!existsSync(ENGINE_OPENAPI_DOCUMENT_FILE)) {
    return undefined;
  }

  const committed = readFileSync(ENGINE_OPENAPI_DOCUMENT_FILE, 'utf8');
  const committedVersion = (JSON.parse(committed) as { info: { version: string } }).info.version;
  const committedMinor = minorVersionOf(committedVersion);
  const engineMinor = minorVersionOf(engineVersion);
  const order = compareMinorVersions(engineMinor, committedMinor);

  if (order === 0) {
    return undefined;
  }

  if (order < 0) {
    throw new Error(
      `The engine's version ${engineVersion} is below the committed document's ${committedVersion}; ` +
        'a version never moves backwards.',
    );
  }

  const archive = archivedOpenApiDocumentFile(committedMinor);

  if (existsSync(archive)) {
    throw new Error(
      `${archive} already exists: version ${committedMinor} was archived earlier and an archive is ` +
        'never rewritten. Check the committed document and the engine version.',
    );
  }

  mkdirSync(dirname(archive), { recursive: true });
  writeFileSync(archive, committed);

  return archive;
}

async function main(): Promise<void> {
  const archive = archiveSupersededDocument(readEngineVersion());
  const app = await createOpenApiApp();
  const document = buildOpenApiDocument(app);

  mkdirSync(dirname(ENGINE_OPENAPI_DOCUMENT_FILE), { recursive: true });
  writeFileSync(ENGINE_OPENAPI_DOCUMENT_FILE, renderOpenApiDocument(document));

  if (archive) {
    process.stdout.write(`${archive}\n`);
  }

  process.stdout.write(`${ENGINE_OPENAPI_DOCUMENT_FILE}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
