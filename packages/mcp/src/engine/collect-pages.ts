export interface PageOfItems<T> {
  items: T[];
  meta: { pagination: { totalPages: number } };
}

export interface CollectedPages<T> {
  items: T[];
  /** True when rows are left unread: more pages than `maxPages`, or more rows than `maxItems`. */
  truncated: boolean;
}

export interface CollectOptions<T> {
  /** Keeps a row that moved between pages while new ones arrived once. */
  getKey?: (item: T) => string;
  /** A filter the engine does not offer; a row it refuses is skipped. */
  accept?: (item: T) => boolean;
  /** Rows to collect; one more accepted row than this ends the read as truncated. */
  maxItems?: number;
}

/**
 * Reads an engine list page by page, newest first, until its last page, `maxPages` or `maxItems`.
 */
export async function collectPages<T>(
  readPage: (page: number) => Promise<PageOfItems<T>>,
  maxPages: number,
  { getKey, accept, maxItems = Number.POSITIVE_INFINITY }: CollectOptions<T> = {},
): Promise<CollectedPages<T>> {
  const seen = new Set<string>();
  const items: T[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const { items: pageItems, meta } = await readPage(page);

    for (const item of pageItems) {
      if (getKey) {
        const key = getKey(item);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
      }

      if (accept && !accept(item)) {
        continue;
      }

      if (items.length >= maxItems) {
        return { items, truncated: true };
      }

      items.push(item);
    }

    if (page >= meta.pagination.totalPages) {
      return { items, truncated: false };
    }
  }

  return { items, truncated: true };
}
