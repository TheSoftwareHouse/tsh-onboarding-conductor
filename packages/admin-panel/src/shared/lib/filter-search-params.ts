import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, PAGE_SIZES, type PageSize } from './pagination';

/** Params the page window is carried in, shared by every filtered list view. */
export const PAGE_PARAM = 'page';
export const LIMIT_PARAM = 'limit';

/** Trimmed value of a free-text criterion, or '' when the URL does not carry it. */
export function readTextParam(params: URLSearchParams, key: string): string {
  return params.get(key)?.trim() ?? '';
}

/**
 * Value of a criterion restricted to a known set, or '' ("All") when the URL carries a value this
 * build does not recognize. A hand-edited or stale link must not filter by a value the endpoint
 * would refuse with a 400.
 */
export function readEnumParam<TValue extends string>(
  params: URLSearchParams,
  key: string,
  isMember: (value: string) => value is TValue,
): '' | TValue {
  const value = readTextParam(params, key);
  return isMember(value) ? value : '';
}

/**
 * Page the URL asks for, falling back to the first page for anything the pager could not have
 * reached: a value that is not a whole number, or one too large to state as an exact offset.
 */
export function readPageParam(params: URLSearchParams): number {
  const requested = Number(readTextParam(params, PAGE_PARAM));
  return Number.isSafeInteger(requested) && requested >= DEFAULT_PAGE ? requested : DEFAULT_PAGE;
}

/** Rows per page the URL asks for, falling back to the default for a size the panel does not offer. */
export function readPageSizeParam(params: URLSearchParams): PageSize {
  const requested = Number(readTextParam(params, LIMIT_PARAM));
  return PAGE_SIZES.find((size) => size === requested) ?? DEFAULT_PAGE_SIZE;
}

/**
 * Search params a committed filter set is carried in. Blank criteria are left out, and the page
 * window is stated only where it differs from the default, so an unfiltered list keeps a bare URL.
 */
export function buildFilterSearchParams(
  criteria: Record<string, string>,
  page: number,
  limit: PageSize,
): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(criteria)) {
    if (value.length > 0) {
      params.set(key, value);
    }
  }

  if (page !== DEFAULT_PAGE) {
    params.set(PAGE_PARAM, String(page));
  }

  if (limit !== DEFAULT_PAGE_SIZE) {
    params.set(LIMIT_PARAM, String(limit));
  }

  return params;
}
