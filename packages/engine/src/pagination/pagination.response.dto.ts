import { ApiProperty } from '@nestjs/swagger';
import type { PaginatedResult } from './paginate';

/** The page window every paginated list endpoint reports back to the caller. */
export class PaginationMetaResponseDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  limit!: number;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'Rows matching the filters, across all pages.',
  })
  total!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  totalPages!: number;
}

/**
 * The `meta` envelope of a paginated list response. Kept as its own object so a future
 * non-pagination concern can be added to `meta` without changing the pagination contract.
 */
export class PaginatedMetaResponseDto {
  @ApiProperty({ type: () => PaginationMetaResponseDto })
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
