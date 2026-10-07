import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import type * as OpenApiPlugin from 'docusaurus-plugin-openapi-docs';
import {
  CURRENT_DOWNLOAD_URL,
  CURRENT_SPEC_PATH,
  listArchivedVersions,
  readCurrentMinorVersion,
  readRegisteredApiVersions,
} from './openapi-versions';
import { tshDark, tshLight } from './src/prism/tsh';

// Onboarding Conductor documentation, skinned with the TSH design system (see src/css/custom.css
// and the theme notes in CLAUDE.md). Three docs instances: Guides (the default), the API reference
// generated from the engine's OpenAPI document, and the Fixtures gallery generated from the
// workflow files. Nothing generated is committed; `pnpm build` regenerates it first.
//
// The API reference is versioned: the current document is the `current` version at /api, and each
// minor version archived under packages/shared/openapi/versions is a Docusaurus version at
// /api/<major.minor>, generated from its frozen document by its own OpenAPI plugin entry below.
// scripts/prepare-api-versions.mjs registers the versions before any `docusaurus` command runs.

const archivedVersions = listArchivedVersions();

// One generator entry per document, all written the same way; `showSchemas` stays off because
// schema pages would add one entry per embedded workflow-schema definition, over a hundred of
// them, and the response and request panels already render every shape inline.
function openApiEntry(
  specPath: string,
  outputDir: string,
  downloadUrl: string,
): OpenApiPlugin.Options {
  return {
    specPath,
    outputDir,
    downloadUrl,
    sidebarOptions: {
      groupPathsBy: 'tag',
      categoryLinkSource: 'tag',
      sidebarCollapsible: false,
      sidebarCollapsed: false,
    },
    showSchemas: false,
    hideSendButton: true,
  };
}

const repository = 'https://github.com/TheSoftwareHouse/tsh-onboarding-conductor';
const editUrl = `${repository}/edit/main/packages/docs/`;

// Vercel publishes the production hostname without a scheme; anything else falls back to the
// address `start` and `serve` listen on (port 3030, leaving 3000 to the engine) so a plain
// `pnpm build` never needs configuration.
const siteUrl =
  process.env.DOCS_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:3030');

const config: Config = {
  title: 'Onboarding Conductor',
  tagline: 'Customer onboarding as a JSON file, not a codebase.',
  url: siteUrl,
  baseUrl: '/',
  favicon: 'img/tsh-signet.svg',
  organizationName: 'TheSoftwareHouse',
  projectName: 'tsh-onboarding-conductor',
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  i18n: { defaultLocale: 'en', locales: ['en'] },
  markdown: {
    // .md is CommonMark, .mdx is MDX: hand-written pages keep braces and angle brackets literal,
    // generated and component-bearing pages opt into MDX by extension.
    format: 'detect',
    mermaid: true,
    hooks: { onBrokenMarkdownLinks: 'throw' },
  },

  themes: [
    '@docusaurus/theme-mermaid',
    'docusaurus-theme-openapi-docs',
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        docsRouteBasePath: ['guides', 'api', 'fixtures'],
        docsDir: ['docs/guides', 'docs/api', 'docs/fixtures'],
        docsPluginIdForPreferredVersion: 'default',
        indexBlog: false,
        indexPages: false,
        language: ['en'],
        searchBarShortcutHint: true,
        searchResultLimits: 8,
        highlightSearchTermsOnTargetPage: false,
      },
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          id: 'default',
          path: 'docs/guides',
          routeBasePath: 'guides',
          sidebarPath: './sidebars/guides.ts',
          editUrl,
          showLastUpdateTime: true,
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    'docusaurus-plugin-sass',
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'fixtures',
        path: 'docs/fixtures',
        routeBasePath: 'fixtures',
        sidebarPath: './sidebars/fixtures.ts',
      },
    ],
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'api',
        path: 'docs/api',
        routeBasePath: 'api',
        sidebarPath: './sidebars/api.ts',
        docItemComponent: '@theme/ApiItem',
        // The current document keeps /api; without this the newest archive would take it and the
        // current one would move to /api/next. The `versions` keys must be versions
        // api_versions.json lists, so they come from that file rather than from the archive.
        lastVersion: 'current',
        versions: {
          current: { label: `${readCurrentMinorVersion()} (current)` },
          ...Object.fromEntries(
            readRegisteredApiVersions().map((version) => [
              version,
              // A frozen contract is still the contract of that engine version, not an
              // unmaintained page, and the info page already prints the exact version.
              { label: version, banner: 'none', badge: false },
            ]),
          ),
        },
      },
    ],
    [
      'docusaurus-plugin-openapi-docs',
      {
        id: 'openapi',
        docsPluginId: 'api',
        config: {
          // The committed document the engine's decorators generate, and each archived minor
          // version's frozen copy; scripts/copy-openapi.mjs publishes them all under static/openapi
          // for download. Entry names must not be `all`, which the plugin's CLI reserves.
          engine: openApiEntry(CURRENT_SPEC_PATH, 'docs/api', CURRENT_DOWNLOAD_URL),
          ...Object.fromEntries(
            archivedVersions.map(({ version, specPath, outputDir, downloadUrl }) => [
              `engine-${version}`,
              openApiEntry(specPath, outputDir, downloadUrl),
            ]),
          ),
        },
      },
    ],
  ],

  themeConfig: {
    colorMode: { defaultMode: 'light', respectPrefersColorScheme: true },
    navbar: {
      title: 'Onboarding Conductor',
      logo: {
        alt: 'The Software House',
        src: 'img/tsh-signet.svg',
        srcDark: 'img/tsh-signet.svg',
        width: 16,
        height: 26,
      },
      hideOnScroll: false,
      items: [
        { type: 'html', position: 'left', value: '<span class="tsh-navbar-eyebrow">Docs</span>' },
        { type: 'docSidebar', sidebarId: 'guides', position: 'left', label: 'Guides' },
        { to: '/api', position: 'left', label: 'API', activeBaseRegex: '^/api' },
        { to: '/fixtures', position: 'left', label: 'Fixtures', activeBaseRegex: '^/fixtures' },
        // The API reference's versions; a plain link while only the current document exists. Not
        // highlighted as active, so it reads as a selector rather than a fourth section.
        {
          type: 'docsVersionDropdown',
          docsPluginId: 'api',
          position: 'right',
          dropdownActiveClassDisabled: true,
        },
        { type: 'search', position: 'right' },
        { href: repository, label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      style: 'light',
      links: [
        {
          title: 'Project',
          items: [
            { label: 'Contributing', href: `${repository}/blob/main/CONTRIBUTING.md` },
            { label: 'Code of conduct', href: `${repository}/blob/main/CODE_OF_CONDUCT.md` },
            { label: 'Decision records', href: `${repository}/tree/main/docs/decisions` },
            {
              label: 'Implementation spec',
              href: `${repository}/blob/main/docs/IMPLEMENTATION.md`,
            },
          ],
        },
      ],
      copyright: `© ${new Date().getFullYear()} The Software House · MIT License`,
    },
    prism: {
      theme: tshLight,
      darkTheme: tshDark,
      additionalLanguages: ['bash', 'json', 'typescript'],
    },
    tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
    docs: { sidebar: { hideable: false, autoCollapseCategories: false } },
  } satisfies Preset.ThemeConfig,
};

export default config;
