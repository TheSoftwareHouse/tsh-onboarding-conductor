import type { KycVerifiedIdentity } from './kyc-provider.port';

/**
 * The fields the mismatch guard compares: last name and date of birth only, explicitly never
 * first name — first names are where transliteration, diminutives and middle-name placement noise
 * lives, and adding them buys more false positives than the guard catches. Widening the guard is
 * a one-line edit to this constant.
 */
export const KYC_IDENTITY_COMPARISON_FIELDS = ['lastName', 'dateOfBirth'] as const;

export type KycIdentityComparisonField = (typeof KYC_IDENTITY_COMPARISON_FIELDS)[number];

export type KycDeclaredIdentity = Readonly<Record<KycIdentityComparisonField, string>>;

/**
 * Three states, not a boolean. `no-verified-data` is distinct from `match`: it means the provider
 * gave us nothing to check against, not that what it gave us agreed.
 */
export type KycIdentityComparisonResult = 'match' | 'mismatch' | 'no-verified-data';

/**
 * The verdict plus which compared fields diverged. Never carries the compared values, only field
 * names, so a caller can log it.
 */
export type KycIdentityComparison = Readonly<{
  result: KycIdentityComparisonResult;
  divergedFields: readonly KycIdentityComparisonField[];
}>;

const DIACRITIC_MARKS_PATTERN = /[̀-ͯ]/g;
const SEPARATOR_PATTERN = /[-\s]+/g;

/**
 * Trim, case-fold, strip diacritics, and collapse internal whitespace. Hyphen and space are
 * folded to the same separator — the one concession to real name formatting, and it is
 * deterministic rather than fuzzy: no edit distance, no threshold, because a threshold is not
 * defensible in an audit.
 */
function normalizeForComparison(value: string): string {
  return value
    .normalize('NFD')
    .replace(DIACRITIC_MARKS_PATTERN, '')
    .replace(SEPARATOR_PATTERN, ' ')
    .trim()
    .toLowerCase();
}

function readVerifiedField(
  verified: KycVerifiedIdentity,
  field: KycIdentityComparisonField,
): string | undefined {
  const value = verified[field];

  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * Compares what the customer declared against what the provider verified on last name and date
 * of birth. We never OCR anything ourselves; the two sides are always the customer's own
 * declaration against the provider's verified data.
 *
 * A field the provider returns no value for is unknown, not a mismatch, and is excluded from the
 * comparison. But if every compared field is unknown, the provider returned no verified identity
 * data at all and the result is `no-verified-data` rather than a default `match`.
 */
export function compareDeclaredIdentity(
  declared: KycDeclaredIdentity,
  verified: KycVerifiedIdentity | undefined,
): KycIdentityComparison {
  if (!verified) {
    return { result: 'no-verified-data', divergedFields: [] };
  }

  const comparisons = KYC_IDENTITY_COMPARISON_FIELDS.map((field) => {
    const verifiedValue = readVerifiedField(verified, field);

    if (verifiedValue === undefined) {
      return { field, outcome: 'unknown' as const };
    }

    const outcome =
      normalizeForComparison(declared[field]) === normalizeForComparison(verifiedValue)
        ? ('match' as const)
        : ('mismatch' as const);

    return { field, outcome };
  });

  if (comparisons.every((comparison) => comparison.outcome === 'unknown')) {
    return { result: 'no-verified-data', divergedFields: [] };
  }

  const divergedFields = comparisons
    .filter((comparison) => comparison.outcome === 'mismatch')
    .map((comparison) => comparison.field);

  return {
    result: divergedFields.length > 0 ? 'mismatch' : 'match',
    divergedFields,
  };
}
