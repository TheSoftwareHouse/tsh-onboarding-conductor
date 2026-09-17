import { z } from 'zod';

/**
 * The `meta.pagination` object every paginated engine endpoint reports. Bounds are deliberately
 * loose (any non-negative integer) because an empty result set reports `totalPages: 0`, and a
 * page past the end reports a `page` higher than `totalPages`.
 */
export const paginationSchema = z.object({
  page: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

/**
 * Wraps a row schema in the engine's `{ items, meta: { pagination } }` list envelope, so each
 * paginated endpoint's client states only what one row looks like.
 */
export function createPaginatedResponseSchema<TItem extends z.ZodTypeAny>(itemSchema: TItem) {
  return z.object({
    items: z.array(itemSchema),
    meta: z.object({ pagination: paginationSchema }),
  });
}
