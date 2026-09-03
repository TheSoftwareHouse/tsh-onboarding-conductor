import type { SumsubApplicantInfo } from './sumsub-client';

/**
 * The connector payload fields this module reads to build `fixedInfo`. Fixed, literal keys — the
 * same convention `twilio-verify.connector.ts` uses for `recipient` — since, unlike the document
 * list (Task 2.1), personal-data field names are not `config`-driven.
 */
type SumsubApplicantPayloadKey =
  | 'firstName'
  | 'lastName'
  | 'dateOfBirth'
  | 'nationality'
  | 'country'
  | 'street'
  | 'town'
  | 'postCode';

/**
 * One postal address. `street`, `town` and `postCode` only ever appear here — never flat on
 * `fixedInfo` — because Sumsub's `individual-standard-v2` level declares them flat but silently
 * does not populate them unless they arrive nested under `addresses[]`. Confirmed against the
 * brief and load-bearing: sent flat, the data is accepted and dropped with no error.
 */
export type SumsubApplicantAddress = Readonly<{
  street?: string;
  town?: string;
  postCode?: string;
}>;

/**
 * The `fixedInfo` body sent to `createApplicant`. `nationality` and `country` are ISO alpha-3,
 * converted from the payload's alpha-2 at this boundary — Sumsub's API rejects alpha-2 silently
 * rather than erroring, so an unmappable code is refused here instead of reaching the provider.
 */
export type SumsubFixedInfo = Readonly<{
  firstName: string;
  lastName: string;
  dob: string;
  nationality: string;
  country: string;
  addresses?: readonly [SumsubApplicantAddress];
}>;

/**
 * A `sumsub_kyc` connector payload missing a required identity field — an authoring defect in the
 * workflow's step data, not a provider error.
 */
export class SumsubApplicantPayloadInvalidError extends Error {
  constructor(key: string) {
    super(`Missing required sumsub_kyc applicant field "${key}"`);
    this.name = 'SumsubApplicantPayloadInvalidError';
  }
}

/**
 * A payload country/nationality code that has no ISO alpha-3 equivalent. Refused rather than
 * passed through — Sumsub accepts an alpha-2 value without complaint and simply mis-registers it.
 */
export class SumsubUnmappableCountryCodeError extends Error {
  constructor(field: string, value: string) {
    super(`Cannot map sumsub_kyc "${field}" value "${value}" to an ISO alpha-3 country code`);
    this.name = 'SumsubUnmappableCountryCodeError';
  }
}

/** ISO 3166-1 alpha-2 to alpha-3, the full assigned list. No package dependency added for this. */
const ISO_ALPHA_2_TO_ALPHA_3: Readonly<Record<string, string>> = {
  AD: 'AND',
  AE: 'ARE',
  AF: 'AFG',
  AG: 'ATG',
  AI: 'AIA',
  AL: 'ALB',
  AM: 'ARM',
  AO: 'AGO',
  AQ: 'ATA',
  AR: 'ARG',
  AS: 'ASM',
  AT: 'AUT',
  AU: 'AUS',
  AW: 'ABW',
  AX: 'ALA',
  AZ: 'AZE',
  BA: 'BIH',
  BB: 'BRB',
  BD: 'BGD',
  BE: 'BEL',
  BF: 'BFA',
  BG: 'BGR',
  BH: 'BHR',
  BI: 'BDI',
  BJ: 'BEN',
  BL: 'BLM',
  BM: 'BMU',
  BN: 'BRN',
  BO: 'BOL',
  BQ: 'BES',
  BR: 'BRA',
  BS: 'BHS',
  BT: 'BTN',
  BV: 'BVT',
  BW: 'BWA',
  BY: 'BLR',
  BZ: 'BLZ',
  CA: 'CAN',
  CC: 'CCK',
  CD: 'COD',
  CF: 'CAF',
  CG: 'COG',
  CH: 'CHE',
  CI: 'CIV',
  CK: 'COK',
  CL: 'CHL',
  CM: 'CMR',
  CN: 'CHN',
  CO: 'COL',
  CR: 'CRI',
  CU: 'CUB',
  CV: 'CPV',
  CW: 'CUW',
  CX: 'CXR',
  CY: 'CYP',
  CZ: 'CZE',
  DE: 'DEU',
  DJ: 'DJI',
  DK: 'DNK',
  DM: 'DMA',
  DO: 'DOM',
  DZ: 'DZA',
  EC: 'ECU',
  EE: 'EST',
  EG: 'EGY',
  EH: 'ESH',
  ER: 'ERI',
  ES: 'ESP',
  ET: 'ETH',
  FI: 'FIN',
  FJ: 'FJI',
  FK: 'FLK',
  FM: 'FSM',
  FO: 'FRO',
  FR: 'FRA',
  GA: 'GAB',
  GB: 'GBR',
  GD: 'GRD',
  GE: 'GEO',
  GF: 'GUF',
  GG: 'GGY',
  GH: 'GHA',
  GI: 'GIB',
  GL: 'GRL',
  GM: 'GMB',
  GN: 'GIN',
  GP: 'GLP',
  GQ: 'GNQ',
  GR: 'GRC',
  GS: 'SGS',
  GT: 'GTM',
  GU: 'GUM',
  GW: 'GNB',
  GY: 'GUY',
  HK: 'HKG',
  HM: 'HMD',
  HN: 'HND',
  HR: 'HRV',
  HT: 'HTI',
  HU: 'HUN',
  ID: 'IDN',
  IE: 'IRL',
  IL: 'ISR',
  IM: 'IMN',
  IN: 'IND',
  IO: 'IOT',
  IQ: 'IRQ',
  IR: 'IRN',
  IS: 'ISL',
  IT: 'ITA',
  JE: 'JEY',
  JM: 'JAM',
  JO: 'JOR',
  JP: 'JPN',
  KE: 'KEN',
  KG: 'KGZ',
  KH: 'KHM',
  KI: 'KIR',
  KM: 'COM',
  KN: 'KNA',
  KP: 'PRK',
  KR: 'KOR',
  KW: 'KWT',
  KY: 'CYM',
  KZ: 'KAZ',
  LA: 'LAO',
  LB: 'LBN',
  LC: 'LCA',
  LI: 'LIE',
  LK: 'LKA',
  LR: 'LBR',
  LS: 'LSO',
  LT: 'LTU',
  LU: 'LUX',
  LV: 'LVA',
  LY: 'LBY',
  MA: 'MAR',
  MC: 'MCO',
  MD: 'MDA',
  ME: 'MNE',
  MF: 'MAF',
  MG: 'MDG',
  MH: 'MHL',
  MK: 'MKD',
  ML: 'MLI',
  MM: 'MMR',
  MN: 'MNG',
  MO: 'MAC',
  MP: 'MNP',
  MQ: 'MTQ',
  MR: 'MRT',
  MS: 'MSR',
  MT: 'MLT',
  MU: 'MUS',
  MV: 'MDV',
  MW: 'MWI',
  MX: 'MEX',
  MY: 'MYS',
  MZ: 'MOZ',
  NA: 'NAM',
  NC: 'NCL',
  NE: 'NER',
  NF: 'NFK',
  NG: 'NGA',
  NI: 'NIC',
  NL: 'NLD',
  NO: 'NOR',
  NP: 'NPL',
  NR: 'NRU',
  NU: 'NIU',
  NZ: 'NZL',
  OM: 'OMN',
  PA: 'PAN',
  PE: 'PER',
  PF: 'PYF',
  PG: 'PNG',
  PH: 'PHL',
  PK: 'PAK',
  PL: 'POL',
  PM: 'SPM',
  PN: 'PCN',
  PR: 'PRI',
  PS: 'PSE',
  PT: 'PRT',
  PW: 'PLW',
  PY: 'PRY',
  QA: 'QAT',
  RE: 'REU',
  RO: 'ROU',
  RS: 'SRB',
  RU: 'RUS',
  RW: 'RWA',
  SA: 'SAU',
  SB: 'SLB',
  SC: 'SYC',
  SD: 'SDN',
  SE: 'SWE',
  SG: 'SGP',
  SH: 'SHN',
  SI: 'SVN',
  SJ: 'SJM',
  SK: 'SVK',
  SL: 'SLE',
  SM: 'SMR',
  SN: 'SEN',
  SO: 'SOM',
  SR: 'SUR',
  SS: 'SSD',
  ST: 'STP',
  SV: 'SLV',
  SX: 'SXM',
  SY: 'SYR',
  SZ: 'SWZ',
  TC: 'TCA',
  TD: 'TCD',
  TF: 'ATF',
  TG: 'TGO',
  TH: 'THA',
  TJ: 'TJK',
  TK: 'TKL',
  TL: 'TLS',
  TM: 'TKM',
  TN: 'TUN',
  TO: 'TON',
  TR: 'TUR',
  TT: 'TTO',
  TV: 'TUV',
  TW: 'TWN',
  TZ: 'TZA',
  UA: 'UKR',
  UG: 'UGA',
  UM: 'UMI',
  US: 'USA',
  UY: 'URY',
  UZ: 'UZB',
  VA: 'VAT',
  VC: 'VCT',
  VE: 'VEN',
  VG: 'VGB',
  VI: 'VIR',
  VN: 'VNM',
  VU: 'VUT',
  WF: 'WLF',
  WS: 'WSM',
  YE: 'YEM',
  YT: 'MYT',
  ZA: 'ZAF',
  ZM: 'ZMB',
  ZW: 'ZWE',
};

function readRequiredString(
  payload: Readonly<Record<string, unknown>>,
  key: SumsubApplicantPayloadKey,
): string {
  const value = payload[key];

  if (typeof value !== 'string' || value.trim() === '') {
    throw new SumsubApplicantPayloadInvalidError(key);
  }

  return value.trim();
}

function readOptionalString(
  payload: Readonly<Record<string, unknown>>,
  key: SumsubApplicantPayloadKey,
): string | undefined {
  const value = payload[key];

  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * Exported because a document's issuing country can be collected from the applicant rather than
 * fixed in config, and that value arrives in alpha-2 like every other country the workflow holds.
 */
export function toAlpha3(alpha2: string, field: string): string {
  const alpha3 = ISO_ALPHA_2_TO_ALPHA_3[alpha2.trim().toUpperCase()];

  if (!alpha3) {
    throw new SumsubUnmappableCountryCodeError(field, alpha2);
  }

  return alpha3;
}

function buildAddress(
  payload: Readonly<Record<string, unknown>>,
): readonly [SumsubApplicantAddress] | undefined {
  const street = readOptionalString(payload, 'street');
  const town = readOptionalString(payload, 'town');
  const postCode = readOptionalString(payload, 'postCode');

  if (street === undefined && town === undefined && postCode === undefined) {
    return undefined;
  }

  return [{ street, town, postCode }];
}

/**
 * Builds the `fixedInfo` body from the connector payload. The two provider traps this task
 * encodes: `street`/`town`/`postCode` are nested under `addresses[]`, never flat; `nationality`
 * and `country` are converted from the payload's alpha-2 to Sumsub's required alpha-3, and an
 * unmappable code throws rather than reaching the provider.
 */
export function buildFixedInfo(payload: Readonly<Record<string, unknown>>): SumsubFixedInfo {
  const firstName = readRequiredString(payload, 'firstName');
  const lastName = readRequiredString(payload, 'lastName');
  const dob = readRequiredString(payload, 'dateOfBirth');
  const nationality = toAlpha3(readRequiredString(payload, 'nationality'), 'nationality');
  const country = toAlpha3(readRequiredString(payload, 'country'), 'country');
  const addresses = buildAddress(payload);

  return {
    firstName,
    lastName,
    dob,
    nationality,
    country,
    ...(addresses ? { addresses } : {}),
  };
}

/**
 * The `fixedInfo` keys the mismatch guard compares, per Open Question 3's answer: last name and
 * date of birth only, explicitly never first name — first names are where transliteration,
 * diminutives and middle-name placement noise lives, and adding them buys more false positives
 * than the guard catches. Widening the guard is a one-line edit to this constant.
 */
export const SUMSUB_IDENTITY_COMPARISON_FIELDS = ['lastName', 'dob'] as const;

export type SumsubIdentityComparisonField = (typeof SUMSUB_IDENTITY_COMPARISON_FIELDS)[number];

/**
 * Three states, not a boolean. `no-verified-data` is distinct from `match`: it means Sumsub gave
 * us nothing to check against, not that what it gave us agreed. Outcome row 3 (Task 3.2) treats
 * `mismatch` and `no-verified-data` the same way but needs to tell them apart in the audit trail.
 */
export type SumsubIdentityComparisonResult = 'match' | 'mismatch' | 'no-verified-data';

const DIACRITIC_MARKS_PATTERN = /[\u0300-\u036f]/g;
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
  verified: SumsubApplicantInfo,
  field: SumsubIdentityComparisonField,
): string | undefined {
  const value = verified[field];

  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * `compareDeclaredIdentity`'s full result: the three-state verdict outcome rows 3 and 7 consume
 * unchanged, plus which of `SUMSUB_IDENTITY_COMPARISON_FIELDS` diverged. The normalisation rule
 * that decides both lives once, here — a caller that needs to log which field disagreed reads
 * `divergedFields` instead of recomputing the comparison. Never carries the two compared values,
 * only field names.
 */
export type SumsubIdentityComparison = Readonly<{
  result: SumsubIdentityComparisonResult;
  divergedFields: readonly SumsubIdentityComparisonField[];
}>;

/**
 * Compares what the customer declared (`fixedInfo`) against what Sumsub verified (the `info`
 * block from `findApplicant`) on last name and date of birth — the input to outcome rule 3
 * (Task 3.2). We never OCR anything ourselves; the two sides are always the customer's own
 * declaration against the provider's verified data, never anything this engine extracted from an
 * image.
 *
 * A field Sumsub returns no value for is unknown, not a mismatch, and is excluded from the
 * comparison. But if every compared field is unknown, that is a different condition — Sumsub
 * returned no verified identity data to check against at all — and is reported as
 * `no-verified-data` rather than defaulting to `match`.
 */
export function compareDeclaredIdentity(
  declared: SumsubFixedInfo,
  verified: SumsubApplicantInfo | undefined,
): SumsubIdentityComparison {
  if (!verified || Object.keys(verified).length === 0) {
    return { result: 'no-verified-data', divergedFields: [] };
  }

  const comparisons = SUMSUB_IDENTITY_COMPARISON_FIELDS.map((field) => {
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
