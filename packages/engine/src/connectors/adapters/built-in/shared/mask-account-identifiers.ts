const MASKED_ACCOUNT_KEYS: ReadonlySet<string> = new Set([
  'iban',
  'accountNumber',
  'number',
  'bic',
]);
const MASK_VISIBLE = 4;

/** Replaces each account identifier with `****` and its last four characters. */
export const maskAccountIdentifiers = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(maskAccountIdentifiers);
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        typeof nested === 'string' && MASKED_ACCOUNT_KEYS.has(key)
          ? `****${nested.slice(-MASK_VISIBLE)}`
          : maskAccountIdentifiers(nested),
      ]),
    );
  }

  return value;
};
