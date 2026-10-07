import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { OpenAPIObject } from '@nestjs/swagger';

const OPENAPI_PACKAGE_DIR = resolve(__dirname, '..', '..', '..', '..', 'shared', 'openapi');

/** The file name every document carries, the current one and each archived one alike. */
export const ENGINE_OPENAPI_DOCUMENT_NAME = 'engine.openapi.json';

/**
 * The committed document, in the reserved `@tsh/openapi` workspace package: the input the
 * documentation site builds from, and what the drift test holds the code to.
 */
export const ENGINE_OPENAPI_DOCUMENT_FILE = join(OPENAPI_PACKAGE_DIR, ENGINE_OPENAPI_DOCUMENT_NAME);

/**
 * Frozen documents of earlier minor versions, one folder per `major.minor`
 * (`versions/0.1/engine.openapi.json`). The generator writes a folder once, when the engine's
 * version moves past the committed document's minor; nothing rewrites it afterwards.
 */
export const ENGINE_OPENAPI_VERSIONS_DIR = join(OPENAPI_PACKAGE_DIR, 'versions');

/** One canonical rendering, so the generator and the drift test cannot disagree on whitespace. */
export function renderOpenApiDocument(document: OpenAPIObject): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

/** `0.1.3` → `0.1`: the part of a version an archive folder is named after. */
export function minorVersionOf(version: string): string {
  const match = /^(\d+)\.(\d+)\./.exec(version);

  if (!match) {
    throw new Error(`"${version}" is not a major.minor.patch version`);
  }

  return `${match[1]}.${match[2]}`;
}

/** Numeric order of two `major.minor` strings: negative, zero or positive like a comparator. */
export function compareMinorVersions(left: string, right: string): number {
  const [leftMajor, leftMinor] = left.split('.').map(Number);
  const [rightMajor, rightMinor] = right.split('.').map(Number);

  return leftMajor === rightMajor ? leftMinor - rightMinor : leftMajor - rightMajor;
}

export function archivedOpenApiDocumentFile(minorVersion: string): string {
  return join(ENGINE_OPENAPI_VERSIONS_DIR, minorVersion, ENGINE_OPENAPI_DOCUMENT_NAME);
}

export type ArchivedOpenApiDocument = { minorVersion: string; file: string };

/** Every archived document, oldest first; empty until the first minor version has been cut. */
export function listArchivedOpenApiDocuments(): ArchivedOpenApiDocument[] {
  if (!existsSync(ENGINE_OPENAPI_VERSIONS_DIR)) {
    return [];
  }

  return readdirSync(ENGINE_OPENAPI_VERSIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      minorVersion: entry.name,
      file: archivedOpenApiDocumentFile(entry.name),
    }))
    .sort((left, right) => compareMinorVersions(left.minorVersion, right.minorVersion));
}

export function readOpenApiDocument(file: string): OpenAPIObject {
  return JSON.parse(readFileSync(file, 'utf8')) as OpenAPIObject;
}
