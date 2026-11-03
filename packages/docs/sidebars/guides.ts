import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

// Top-level categories render as eyebrow labels (custom.css, .theme-doc-sidebar-item-category-level-1).
// Only pages that exist are listed; the Workflows and Extending groups from the design handoff
// join once their articles are written.
const sidebars: SidebarsConfig = {
  guides: [
    {
      type: 'category',
      label: 'Start here',
      collapsible: false,
      items: [
        'introduction',
        'getting-started',
        'your-first-onboarding',
        'configuration',
        'extending',
      ],
    },
    {
      type: 'category',
      label: 'Operating',
      collapsible: false,
      items: ['operating/ai-assistant', 'operating/connecting', 'operating/trying-it-locally'],
    },
  ],
};

export default sidebars;
