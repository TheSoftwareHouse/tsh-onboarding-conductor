import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';
// Written by `pnpm run api:generate` (docusaurus-plugin-openapi-docs); never committed. Its default
// export is the array of sidebar items. Each generated endpoint item carries
// `className: api-method <verb>`, which custom.css turns into the mono method prefix in the sidebar.
import generatedSidebar from '../docs/api/sidebar';
import { buildApiSidebar } from './api-items';

// The current version's sidebar. Each archived version gets the same shape as JSON under
// api_versioned_sidebars/, written by scripts/finish-api-pages.mjs from the same builder.
const INFO_DOC_ID = 'tsh-onboarding-conductor-engine-api';

const sidebars: SidebarsConfig = {
  api: buildApiSidebar(generatedSidebar, 'api/', INFO_DOC_ID),
};

export default sidebars;
