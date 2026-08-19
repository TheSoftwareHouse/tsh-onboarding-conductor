/** Columns a filter panel is laid out in when its field count allows a choice. */
const PREFERRED_COLUMNS = 4;

/** Widest a row is allowed to get, past which fields are too narrow to read their own values. */
const MAX_COLUMNS = 6;

/**
 * How many columns a panel of `fieldCount` criteria should be laid out in, so that every row is
 * filled and the panel leaves no dead space at the end of one.
 *
 * A count that divides the fields evenly is what fills the grid, so the divisor nearest the
 * preferred four is chosen - three for six fields, four for eight, five for five. A count with no
 * usable divisor, such as seven, falls back to the preferred width and leaves its last row short,
 * which is the one case the grid cannot fill.
 */
export function chooseFilterColumns(fieldCount: number): number {
  if (fieldCount < 1) {
    return PREFERRED_COLUMNS;
  }

  const fallback = Math.min(fieldCount, PREFERRED_COLUMNS);
  const divisors = Array.from({ length: Math.min(fieldCount, MAX_COLUMNS) }, (_unused, index) => {
    return index + 1;
  }).filter((columns) => fieldCount % columns === 0);

  // Seeded with the narrowest divisor rather than with the fallback, which is not itself a divisor
  // and would win every comparison against one.
  const nearestPreferred = divisors.reduce((best, columns) => {
    return Math.abs(columns - PREFERRED_COLUMNS) < Math.abs(best - PREFERRED_COLUMNS)
      ? columns
      : best;
  });

  // One column would stack a panel that has room for a row, which only happens for a field count
  // no divisor fits, such as seven.
  return nearestPreferred === 1 && fieldCount > 1 ? fallback : nearestPreferred;
}
