import type { PaginatedResult } from './paginate';

/** The page window every paginated list endpoint reports back to the caller. */
export class PaginationMetaResponseDto {
  page!: number;
  limit!: number;
  total!: number;
  totalPages!: number;
}

/**
 * The `meta` envelope of a paginated list response. Kept as its own object so a future
 * non-pagination concern can be added to `meta` without changing the pagination contract.
 */
export class PaginatedMetaResponseDto {
  pagination!: PaginationMetaResponseDto;
}

/** Projects a repository result onto the response envelope, dropping the rows themselves. */
export function toPaginatedMeta(result: PaginatedResult<unknown>): PaginatedMetaResponseDto {
  return {
    pagination: {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: result.totalPages,
    },
  };
}
