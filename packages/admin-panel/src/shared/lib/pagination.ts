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
