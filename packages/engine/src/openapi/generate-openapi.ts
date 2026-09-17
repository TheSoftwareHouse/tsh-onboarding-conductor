import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildOpenApiDocument } from './openapi-document';
import { createOpenApiApp } from './testing/create-openapi-app';
import { ENGINE_OPENAPI_DOCUMENT_FILE, renderOpenApiDocument } from './testing/openapi-artifact';

// Writes the OpenAPI document the engine's decorators describe to the committed artefact.
// `openapi-document.spec.ts` fails whenever that file no longer matches the code, so this is what
// to run after changing a route, a DTO or an error contract.
//
// Usage: pnpm openapi:generate

async function main(): Promise<void> {
  const app = await createOpenApiApp();
  const document = buildOpenApiDocument(app);

  mkdirSync(dirname(ENGINE_OPENAPI_DOCUMENT_FILE), { recursive: true });
  writeFileSync(ENGINE_OPENAPI_DOCUMENT_FILE, renderOpenApiDocument(document));
  process.stdout.write(`${ENGINE_OPENAPI_DOCUMENT_FILE}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
