import { collectPages, PageOfItems } from './collect-pages';

function pagesOf(...pages: number[][]): (page: number) => Promise<PageOfItems<number>> {
  return (page) =>
    Promise.resolve({
      items: pages[page - 1] ?? [],
      meta: { pagination: { totalPages: pages.length } },
    });
}

describe('collectPages', () => {
  it('reads every page and reports a complete read', async () => {
    const result = await collectPages(pagesOf([1, 2], [3]), 10);

    expect(result).toEqual({ items: [1, 2, 3], truncated: false });
  });

  it('stops at the page cap and says rows are left', async () => {
    const readPage = jest.fn(pagesOf([1], [2], [3]));

    const result = await collectPages(readPage, 2);

    expect(result).toEqual({ items: [1, 2], truncated: true });
    expect(readPage).toHaveBeenCalledTimes(2);
  });

  it('is complete when the last page is the capped one', async () => {
    expect(await collectPages(pagesOf([1], [2]), 2)).toEqual({ items: [1, 2], truncated: false });
  });

  it('keeps a row that moved between pages once', async () => {
    const result = await collectPages(pagesOf([1, 2], [2, 3]), 10, { getKey: String });

    expect(result.items).toEqual([1, 2, 3]);
  });

  it('skips rows the filter refuses', async () => {
    const result = await collectPages(pagesOf([1, 2, 3, 4]), 10, { accept: (n) => n % 2 === 0 });

    expect(result).toEqual({ items: [2, 4], truncated: false });
  });

  it('truncates only when a row beyond maxItems exists', async () => {
    expect(await collectPages(pagesOf([1, 2]), 10, { maxItems: 2 })).toEqual({
      items: [1, 2],
      truncated: false,
    });
    expect(await collectPages(pagesOf([1, 2], [3]), 10, { maxItems: 2 })).toEqual({
      items: [1, 2],
      truncated: true,
    });
  });

  it('does not count a refused row against maxItems', async () => {
    const result = await collectPages(pagesOf([1, 2, 3, 4]), 10, {
      accept: (n) => n === 4,
      maxItems: 1,
    });

    expect(result).toEqual({ items: [4], truncated: false });
  });
});
