/**
 * How many criteria a filter set actually narrows by. Blank text and a criterion left at its
 * "All" value - both the empty string - do not count, so the number matches what the operator
 * reads as active.
 *
 * Keys the endpoint always receives, such as the page window, are ignored rather than counted:
 * choosing a page size narrows nothing.
 */
export function countActiveFilters<TFilters extends object>(
  filters: TFilters,
  ignoredKeys: readonly (keyof TFilters)[] = [],
): number {
  const ignored = ignoredKeys as readonly string[];

  return Object.entries(filters).filter(([key, value]) => {
    if (ignored.includes(key)) {
      return false;
    }

    return typeof value === 'string'
      ? value.trim().length > 0
      : value !== null && value !== undefined;
  }).length;
}

/** Whether any criterion narrows the list, which is what distinguishes "no rows" from "no match". */
export function hasActiveFilters<TFilters extends object>(
  filters: TFilters,
  ignoredKeys: readonly (keyof TFilters)[] = [],
): boolean {
  return countActiveFilters(filters, ignoredKeys) > 0;
}
