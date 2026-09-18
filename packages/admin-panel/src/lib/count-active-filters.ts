/** How many criteria a filter set narrows by; ignored keys, such as the page window, never count. */
export function countActiveFilters<TFilters extends object>(
  filters: TFilters,
  ignoredKeys: readonly (keyof TFilters)[] = [],
): number {
  const ignored = ignoredKeys as readonly string[];

  return Object.entries(filters).filter(([key, value]) => {
    if (ignored.includes(key)) {
      return false;
    }

    // Blank is unreachable from the panel's null-native search state, but is still refused here so
    // the helper holds for any filter shape that carries `''`.
    return typeof value === 'string'
      ? value.trim().length > 0
      : value !== null && value !== undefined;
  }).length;
}
