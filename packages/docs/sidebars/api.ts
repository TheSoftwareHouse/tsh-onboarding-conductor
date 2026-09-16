import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';
// Written by `pnpm run api:generate` (docusaurus-plugin-openapi-docs); never committed. Its default
// export is the array of sidebar items. Each generated endpoint item carries
// `className: api-method <verb>`, which custom.css turns into the mono method prefix in the sidebar.
import generatedSidebar from '../docs/api/sidebar';

// The package exports only the whole-config type; the item type is the element of its array form.
type SidebarItemConfig = Extract<SidebarsConfig[string], readonly unknown[]>[number];

const INFO_DOC_ID = 'tsh-onboarding-conductor-engine-api';

// Docusaurus loads sidebar files through an interop layer that hands over either the default export
// itself or a `{ default }` wrapper around it. Only those two shapes are accepted; anything else means
// the file is missing or the generator changed what it writes. Never follow `.default` in a loop:
// the wrapper can point back at itself, and a loop there hangs `start` and `build` at 100% CPU.
function generatedItems(value: unknown): SidebarItemConfig[] {
  if (Array.isArray(value)) {
    return value as SidebarItemConfig[];
  }

  const wrapped = (value as { default?: unknown } | null | undefined)?.default;

  if (Array.isArray(wrapped)) {
    return wrapped as SidebarItemConfig[];
  }

  throw new Error('Generated API sidebar not found; run `pnpm run api:generate` first.');
}

// The generator assumes it writes into a subfolder of the default docs instance and prefixes every id
// with `api/`. This instance's root is `docs/api` itself, so the prefix has to go.
function localizeIds(items: SidebarItemConfig[]): SidebarItemConfig[] {
  return items.map((item) => {
    if (typeof item === 'string') {
      return item.replace(/^api\//, '');
    }

    if (item.type === 'doc') {
      return { ...item, id: item.id.replace(/^api\//, '') };
    }

    if (item.type === 'category') {
      return {
        ...item,
        link:
          item.link?.type === 'doc'
            ? { ...item.link, id: item.link.id.replace(/^api\//, '') }
            : item.link,
        items: Array.isArray(item.items) ? localizeIds(item.items) : item.items,
      };
    }

    return item;
  });
}

const endpointItems = localizeIds(generatedItems(generatedSidebar)).filter(
  (item) => !(typeof item === 'object' && item.type === 'doc' && item.id === INFO_DOC_ID),
);

const sidebars: SidebarsConfig = {
  api: [
    {
      type: 'category',
      label: 'Overview',
      collapsible: false,
      items: [
        'index',
        'authentication',
        'errors',
        INFO_DOC_ID, // labelled by scripts/label-info-page.mjs, since front matter beats a sidebar label
      ],
    },
    ...endpointItems,
  ],
};

export default sidebars;
