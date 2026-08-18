import { countTotalPages, paginateQueryBuilder, resolvePaginationWindow } from './paginate';
import { DEFAULT_PAGINATION_LIMIT, DEFAULT_PAGINATION_PAGE } from './pagination.query.dto';

type QueryBuilderDouble = {
  clone: jest.Mock;
  skip: jest.Mock;
  take: jest.Mock;
  getMany: jest.Mock;
  getCount: jest.Mock;
};

const createQueryBuilderDouble = (total: number, rows: unknown[]): QueryBuilderDouble => {
  const countQueryBuilder = { getCount: jest.fn().mockResolvedValue(total) };

  return {
    clone: jest.fn().mockReturnValue(countQueryBuilder),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows),
    getCount: countQueryBuilder.getCount,
  };
};

describe('resolvePaginationWindow', () => {
  it('falls back to the shared defaults when no window was requested', () => {
    expect(resolvePaginationWindow()).toEqual({
      page: DEFAULT_PAGINATION_PAGE,
      limit: DEFAULT_PAGINATION_LIMIT,
    });
    expect(resolvePaginationWindow({})).toEqual({
      page: DEFAULT_PAGINATION_PAGE,
      limit: DEFAULT_PAGINATION_LIMIT,
    });
  });

  it('fills in only the missing half of a partially stated window', () => {
    expect(resolvePaginationWindow({ page: 4 })).toEqual({
      page: 4,
      limit: DEFAULT_PAGINATION_LIMIT,
    });
    expect(resolvePaginationWindow({ limit: 50 })).toEqual({
      page: DEFAULT_PAGINATION_PAGE,
      limit: 50,
    });
  });

  it('keeps a fully stated window as it was requested', () => {
    expect(resolvePaginationWindow({ page: 3, limit: 10 })).toEqual({ page: 3, limit: 10 });
  });
});

describe('countTotalPages', () => {
  it.each([
    [0, 20, 0],
    [1, 20, 1],
    [20, 20, 1],
    [21, 20, 2],
    [21, 10, 3],
  ])('reports %i rows at %i per page as %i pages', (total, limit, expected) => {
    expect(countTotalPages(total, limit)).toBe(expected);
  });
});

describe('paginateQueryBuilder', () => {
  it('reads the first page without an offset and reports the window', async () => {
    const rows = [{ id: 'row-1' }];
    const queryBuilder = createQueryBuilderDouble(1, rows);

    const result = await paginateQueryBuilder(queryBuilder as never, { page: 1, limit: 20 });

    expect(queryBuilder.skip).toHaveBeenCalledWith(0);
    expect(queryBuilder.take).toHaveBeenCalledWith(20);
    expect(result).toEqual({ items: rows, total: 1, page: 1, limit: 20, totalPages: 1 });
  });

  it('offsets a later page by the pages already skipped', async () => {
    const queryBuilder = createQueryBuilderDouble(21, []);

    const result = await paginateQueryBuilder(queryBuilder as never, { page: 3, limit: 10 });

    expect(queryBuilder.skip).toHaveBeenCalledWith(20);
    expect(queryBuilder.take).toHaveBeenCalledWith(10);
    expect(result).toEqual({ items: [], total: 21, page: 3, limit: 10, totalPages: 3 });
  });

  it('counts every matching row on a clone so the page does not narrow the total', async () => {
    const queryBuilder = createQueryBuilderDouble(97, [{ id: 'row-1' }]);

    const result = await paginateQueryBuilder(queryBuilder as never, { page: 2, limit: 20 });

    expect(queryBuilder.clone).toHaveBeenCalledTimes(1);
    expect(result.total).toBe(97);
    expect(result.totalPages).toBe(5);
  });

  it('reports no pages at all when nothing matched', async () => {
    const queryBuilder = createQueryBuilderDouble(0, []);

    const result = await paginateQueryBuilder(queryBuilder as never, { page: 1, limit: 20 });

    expect(result).toEqual({ items: [], total: 0, page: 1, limit: 20, totalPages: 0 });
  });
});
