import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

// The package exports only the whole-config type; the item type is the element of its array form.
export type SidebarItemConfig = Extract<SidebarsConfig[string], readonly unknown[]>[number];

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

// The generator prefixes every id with the last segment of its output directory, assuming it
// writes into a subfolder of the default docs instance: `api/` for docs/api, `version-0.1/` for
// api_versioned_docs/version-0.1. Each output directory is a docs root of its own here, so the
// prefix has to go — and Docusaurus rejects the `version-*/` form outright.
function localizeIds(items: SidebarItemConfig[], prefix: string): SidebarItemConfig[] {
  const strip = (id: string): string => (id.startsWith(prefix) ? id.slice(prefix.length) : id);

  return items.map((item) => {
    if (typeof item === 'string') {
      return strip(item);
    }

    if (item.type === 'doc') {
      return { ...item, id: strip(item.id) };
    }

    if (item.type === 'category') {
      return {
        ...item,
        link: item.link?.type === 'doc' ? { ...item.link, id: strip(item.link.id) } : item.link,
        items: Array.isArray(item.items) ? localizeIds(item.items, prefix) : item.items,
      };
    }

    return item;
  });
}

/**
 * The `api` sidebar of one version: the hand-written overview pages, the document's own info page
 * (labelled by scripts/finish-api-pages.mjs, since front matter beats a sidebar label) and then
 * the generated tag categories. `generated` is what the plugin's `sidebar.ts` exports; `idPrefix`
 * is what it prefixed every id with; `infoDocId` is the info page's id, which the generator also
 * lists first and which moves into the overview category here.
 */
export function buildApiSidebar(
  generated: unknown,
  idPrefix: string,
  infoDocId: string,
): SidebarItemConfig[] {
  const endpointItems = localizeIds(generatedItems(generated), idPrefix).filter(
    (item) => !(typeof item === 'object' && item.type === 'doc' && item.id === infoDocId),
  );

  return [
    {
      type: 'category',
      label: 'Overview',
      collapsible: false,
      items: ['index', 'authentication', 'errors', infoDocId],
    },
    ...endpointItems,
  ];
}
