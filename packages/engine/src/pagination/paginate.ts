import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { DEFAULT_PAGINATION_LIMIT, DEFAULT_PAGINATION_PAGE } from './pagination.query.dto';

/** The window a request asked for, once defaults have been filled in. */
export interface PaginationWindow {
  page: number;
  limit: number;
}

/** One page of rows together with the window it was taken from. */
export interface PaginatedResult<TItem> {
  items: TItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Fills in the defaults for a query DTO that may not have been through a transforming validation
 * pipe. Repositories call this rather than reading `query.page` directly, so a caller that passes
 * a hand-built filter object still gets the same window the HTTP surface would have produced.
 */
export function resolvePaginationWindow(query?: Partial<PaginationWindow>): PaginationWindow {
  return {
    page: query?.page ?? DEFAULT_PAGINATION_PAGE,
    limit: query?.limit ?? DEFAULT_PAGINATION_LIMIT,
  };
}

/** Page count for a total, reported as 0 rather than 1 when nothing matched. */
export function countTotalPages(total: number, limit: number): number {
  return total > 0 ? Math.ceil(total / limit) : 0;
}

/**
 * Applies a window to a query builder and reports the page alongside the unpaginated total.
 *
 * The count runs against a clone so that `skip`/`take` cannot narrow it: the total has to describe
 * every matching row, not the page. Callers are expected to have set the ordering already — an
 * unordered paginated query returns overlapping pages.
 */
export async function paginateQueryBuilder<TEntity extends ObjectLiteral>(
  queryBuilder: SelectQueryBuilder<TEntity>,
  paginationWindow: PaginationWindow,
): Promise<PaginatedResult<TEntity>> {
  const { page, limit } = paginationWindow;
  const total = await queryBuilder.clone().getCount();
  const items = await queryBuilder
    .skip((page - 1) * limit)
    .take(limit)
    .getMany();

  return { items, total, page, limit, totalPages: countTotalPages(total, limit) };
}
