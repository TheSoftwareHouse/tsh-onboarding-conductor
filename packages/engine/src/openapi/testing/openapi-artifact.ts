import { resolve } from 'node:path';
import type { OpenAPIObject } from '@nestjs/swagger';

/**
 * The committed document, in the reserved `@tsh/openapi` workspace package: the input the
 * documentation site builds from, and what the drift test holds the code to.
 */
export const ENGINE_OPENAPI_DOCUMENT_FILE = resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'shared',
  'openapi',
  'engine.openapi.json',
);

/** One canonical rendering, so the generator and the drift test cannot disagree on whitespace. */
export function renderOpenApiDocument(document: OpenAPIObject): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
