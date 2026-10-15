// Where the engine's OpenAPI documents are and what the site generates from them. The current
// document is `packages/shared/openapi/engine.openapi.json`; each earlier minor version is frozen
// under `packages/shared/openapi/versions/<major.minor>/` by `pnpm openapi:generate` the first time
// the engine's version moves past it (see the generator in packages/engine/src/openapi). The site
// renders every archived document as a Docusaurus version of the `api` docs instance.
//
// Loaded by docusaurus.config.ts through Docusaurus' module loader and by the scripts under
// scripts/ through Node's own type stripping, so this file keeps to the TypeScript Node can erase:
// no enums, no parameter properties, `import type` for types.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDir = dirname(fileURLToPath(import.meta.url));
const openapiPackageDir = resolve(siteDir, '..', 'shared', 'openapi');

export const OPENAPI_DOCUMENT_NAME = 'engine.openapi.json';

/** The current document, the one the `api` instance's `current` version is generated from. */
export const CURRENT_DOCUMENT_FILE = join(openapiPackageDir, OPENAPI_DOCUMENT_NAME);
export const ARCHIVE_DIR = join(openapiPackageDir, 'versions');

/** The hand-written and generated pages of the current version. */
export const API_DOCS_DIR = join(siteDir, 'docs', 'api');
/** Docusaurus' versioning files for a docs instance with id `api`; all generated, none committed. */
export const API_VERSIONS_FILE = join(siteDir, 'api_versions.json');
export const API_VERSIONED_DOCS_DIR = join(siteDir, 'api_versioned_docs');
export const API_VERSIONED_SIDEBARS_DIR = join(siteDir, 'api_versioned_sidebars');
/** Where the documents are published for download, same origin as the site. */
export const STATIC_OPENAPI_DIR = join(siteDir, 'static', 'openapi');

/** The site-relative paths Docusaurus and the OpenAPI plugin resolve against the site directory. */
export const CURRENT_SPEC_PATH = `../shared/openapi/${OPENAPI_DOCUMENT_NAME}`;
export const CURRENT_DOWNLOAD_URL = `/openapi/${OPENAPI_DOCUMENT_NAME}`;

export type ArchivedVersion = {
  /** `major.minor`, the folder name, the Docusaurus version name and the route segment. */
  version: string;
  specFile: string;
  /** Relative to the site directory, as the OpenAPI plugin wants them. */
  specPath: string;
  outputDir: string;
  downloadUrl: string;
  docsDir: string;
  sidebarFile: string;
};

/** `0.1.3` → `0.1`. */
export function minorVersionOf(version: string): string {
  const match = /^(\d+)\.(\d+)\./.exec(version);

  if (!match) {
    throw new Error(`"${version}" is not a major.minor.patch version`);
  }

  return `${match[1]}.${match[2]}`;
}

function compareVersionsDescending(left: string, right: string): number {
  const [leftMajor, leftMinor] = left.split('.').map(Number);
  const [rightMajor, rightMinor] = right.split('.').map(Number);

  return leftMajor === rightMajor ? rightMinor - leftMinor : rightMajor - leftMajor;
}

/** Every archived document, newest first, the order a version dropdown lists them in. */
export function listArchivedVersions(): ArchivedVersion[] {
  if (!existsSync(ARCHIVE_DIR)) {
    return [];
  }

  return readdirSync(ARCHIVE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareVersionsDescending)
    .map((version) => ({
      version,
      specFile: join(ARCHIVE_DIR, version, OPENAPI_DOCUMENT_NAME),
      specPath: `../shared/openapi/versions/${version}/${OPENAPI_DOCUMENT_NAME}`,
      outputDir: `api_versioned_docs/version-${version}`,
      downloadUrl: `/openapi/${version}/${OPENAPI_DOCUMENT_NAME}`,
      docsDir: join(API_VERSIONED_DOCS_DIR, `version-${version}`),
      sidebarFile: join(API_VERSIONED_SIDEBARS_DIR, `version-${version}-sidebars.json`),
    }));
}

/** The `major.minor` of the current document, the label of the `current` version. */
export function readCurrentMinorVersion(): string {
  const document = JSON.parse(readFileSync(CURRENT_DOCUMENT_FILE, 'utf8')) as {
    info: { version: string };
  };

  return minorVersionOf(document.info.version);
}

/**
 * The versions `scripts/prepare-api-versions.mjs` registered with Docusaurus, or none. The config
 * reads this rather than the archive so that its `versions` option can never name a version the
 * versions file does not list, which Docusaurus rejects.
 */
export function readRegisteredApiVersions(): string[] {
  if (!existsSync(API_VERSIONS_FILE)) {
    return [];
  }

  return JSON.parse(readFileSync(API_VERSIONS_FILE, 'utf8')) as string[];
}
