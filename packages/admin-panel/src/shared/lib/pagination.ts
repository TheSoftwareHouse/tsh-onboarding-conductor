/** Page window a paginated engine endpoint reports alongside the rows it returned. */
export interface PaginationWindow {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Page sizes offered to the operator, bounded by the engine's own `MAX_PAGINATION_LIMIT` of 100 so
 * a selection can never be refused with a 400.
 */
export const PAGE_SIZES = [20, 50, 100] as const;

export type PageSize = (typeof PAGE_SIZES)[number];

export const DEFAULT_PAGE_SIZE: PageSize = 20;

/** First page, which is also where committing new filter criteria always returns the operator. */
export const DEFAULT_PAGE = 1;

/**
 * Page the operator named by typing into the pager, clamped to the window the endpoint reported
 * so a number past the end lands on the last page rather than on nothing.
 *
 * Returns null for a value that names no page - blank, or anything that is not a whole number -
 * which leaves the pager where it is.
 */
export function resolvePageJump(value: string, totalPages: number): number | null {
  const requested = value.trim();

  if (!/^\d+$/.test(requested)) {
    return null;
  }

  // A window the endpoint reported as empty still has a first page to sit on.
  const lastPage = Math.max(totalPages, DEFAULT_PAGE);

  return Math.min(Math.max(Number(requested), DEFAULT_PAGE), lastPage);
}
