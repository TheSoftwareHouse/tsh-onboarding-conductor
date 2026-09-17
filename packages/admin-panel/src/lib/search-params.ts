import { createParser, parseAsNumberLiteral } from 'nuqs';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, PAGE_SIZES } from './pagination';

/** Trims a criterion and reduces blank to null — the one place that rule is written; see ADR 0018. */
export function trimmedOrNull(value: string): string | null {
  return value.trim() || null;
}

/** A free-text criterion as a URL states it: trimmed, and absent when blank — see ADR 0018 for why. */
export const parseAsTrimmedString = createParser<string>({
  parse: trimmedOrNull,
  serialize: (value) => value,
});

/** Page the URL asks for; `parseAsInteger` accepts 0/negatives and truncates 1.5, so this checks safe-integer directly. */
export const parseAsPageNumber = createParser<number>({
  parse: (value) => {
    const requested = Number(value);
    return Number.isSafeInteger(requested) && requested >= DEFAULT_PAGE ? requested : null;
  },
  serialize: (value) => String(value),
}).withDefault(DEFAULT_PAGE);

/** Rows per page the URL asks for, falling back to the default for a size the panel does not offer. */
export const parseAsPageSize = parseAsNumberLiteral(PAGE_SIZES).withDefault(DEFAULT_PAGE_SIZE);
