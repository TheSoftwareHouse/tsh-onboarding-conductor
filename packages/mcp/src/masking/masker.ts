import { createHmac } from 'node:crypto';
import {
  CODE_MAP,
  findMetadataAllowlist,
  MASKED_DATA,
  type MetadataAllowlist,
  type MetadataRule,
  NUMBER_MAP,
  SCALAR,
  SCALAR_LIST,
  SCALAR_RECORD_LIST,
  SNAPSHOT_ALLOWLIST,
} from './audit-allowlists';
import {
  AGE_BAND_YEARS,
  FieldClass,
  MAX_PLAUSIBLE_AGE_YEARS,
  PSEUDONYM_HEX_LENGTH,
  PseudonymFormat,
} from './masking.constants';
import type {
  AuditEntry,
  CsvColumnClasses,
  FieldClassification,
  FieldClassMap,
  MaskedAuditEntry,
  MaskedRecord,
  MaskedValue,
} from './masking.types';

const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;
const NON_DIGITS = /\D/g;
const INTERNATIONAL_CALL_PREFIX = /^00/;

type Scalar = string | number | boolean;
type PlainObject = Record<string, unknown>;

const isScalar = (value: unknown): value is Scalar =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

const isPlainObject = (value: unknown): value is PlainObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isScalarOrNull = (value: unknown): value is Scalar | null =>
  value === null || isScalar(value);

/**
 * Decides what of an onboarding's data may reach the model and rewrites the rest. Pseudonyms are
 * keyed, so one applicant's email and phone stay countable across rows without being readable;
 * dates of birth become ten-year bands against `clock`. Everything the classes do not name is
 * dropped. Masking protects what reaches the model; it is not access control.
 */
export class Masker {
  constructor(
    private readonly key: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** The masked form of one value, `null` when there was nothing to mask, `undefined` when dropped. */
  maskValue(value: unknown, classification: FieldClassification): MaskedValue | undefined {
    if (classification.class === FieldClass.DROP) {
      return undefined;
    }

    if (value === null || value === undefined || value === '') {
      return null;
    }

    switch (classification.class) {
      case FieldClass.PASS:
        return this.maskPassed(value, classification.numericOnly === true);
      case FieldClass.PSEUDONYMISE:
        return this.pseudonymise(value, classification.format);
      case FieldClass.GENERALISE:
        return this.toAgeBand(value);
    }
  }

  /** An onboarding's collected data, keeping only the fields the classes let through. */
  maskCollectedData(data: Readonly<Record<string, unknown>>, classes: FieldClassMap): MaskedRecord {
    return this.maskEntries(data, (name) => classes.get(name));
  }

  /** One parsed CSV row keyed by header, masked column by column. */
  maskCsvRow(row: Readonly<Record<string, string>>, columns: CsvColumnClasses): MaskedRecord {
    return this.maskEntries(row, (header) => columns.get(header));
  }

  /**
   * An audit row with the metadata and snapshots reduced to the keys its action family allows;
   * `submittedData` inside it is masked by `classes`, the onboarding's field classes.
   */
  maskAuditEntry(entry: AuditEntry, classes: FieldClassMap = new Map()): MaskedAuditEntry {
    const { metadata, before, after, ...identifying } = entry;
    const allowlist = findMetadataAllowlist(entry.action);
    const masked: MaskedAuditEntry = {
      ...identifying,
      metadata: allowlist ? this.applyAllowlist(metadata, allowlist, classes) : {},
    };

    if (before !== undefined) {
      masked.before =
        before === null ? null : this.applyAllowlist(before, SNAPSHOT_ALLOWLIST, classes);
    }

    if (after !== undefined) {
      masked.after =
        after === null ? null : this.applyAllowlist(after, SNAPSHOT_ALLOWLIST, classes);
    }

    return masked;
  }

  private maskEntries(
    source: Readonly<Record<string, unknown>>,
    findClassification: (name: string) => FieldClassification | undefined,
  ): MaskedRecord {
    const entries: [string, MaskedValue][] = [];

    for (const [name, value] of Object.entries(source)) {
      const classification = findClassification(name);
      const masked = classification ? this.maskValue(value, classification) : undefined;

      if (masked !== undefined) {
        entries.push([name, masked]);
      }
    }

    return Object.fromEntries(entries);
  }

  private maskPassed(value: unknown, numericOnly: boolean): MaskedValue | undefined {
    if (numericOnly) {
      return (typeof value === 'number' || typeof value === 'string') &&
        Number.isFinite(Number(value))
        ? value
        : undefined;
    }

    if (isScalar(value)) {
      return value;
    }

    return Array.isArray(value) && value.every(isScalar) ? value : undefined;
  }

  private pseudonymise(value: unknown, format: PseudonymFormat): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalised =
      format === PseudonymFormat.EMAIL
        ? value.trim().toLowerCase()
        : value.trim().replace(INTERNATIONAL_CALL_PREFIX, '').replace(NON_DIGITS, '');

    if (normalised === '') {
      return undefined;
    }

    const digest = createHmac('sha256', this.key).update(normalised).digest('hex');
    return `${format}:${digest.slice(0, PSEUDONYM_HEX_LENGTH)}`;
  }

  private toAgeBand(value: unknown): string | undefined {
    const match = typeof value === 'string' ? ISO_DATE_PREFIX.exec(value.trim()) : null;

    if (!match) {
      return undefined;
    }

    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const born = new Date(Date.UTC(year, month - 1, day));

    if (
      born.getUTCFullYear() !== year ||
      born.getUTCMonth() !== month - 1 ||
      born.getUTCDate() !== day
    ) {
      return undefined;
    }

    const now = this.clock();
    const birthdayPassed =
      now.getUTCMonth() + 1 > month || (now.getUTCMonth() + 1 === month && now.getUTCDate() >= day);
    const age = now.getUTCFullYear() - year - (birthdayPassed ? 0 : 1);

    if (age < 0 || age > MAX_PLAUSIBLE_AGE_YEARS) {
      return undefined;
    }

    const lower = Math.floor(age / AGE_BAND_YEARS) * AGE_BAND_YEARS;
    return `${lower}-${lower + AGE_BAND_YEARS - 1}`;
  }

  private applyAllowlist(
    source: unknown,
    allowlist: MetadataAllowlist,
    classes: FieldClassMap,
  ): MaskedRecord {
    if (!isPlainObject(source)) {
      return {};
    }

    const entries: [string, MaskedValue][] = [];

    for (const [key, rule] of Object.entries(allowlist)) {
      const value = Object.hasOwn(source, key) ? source[key] : undefined;
      const kept = value === undefined ? undefined : this.applyRule(value, rule, classes);

      if (kept !== undefined) {
        entries.push([key, kept]);
      }
    }

    return Object.fromEntries(entries);
  }

  private applyRule(
    value: unknown,
    rule: MetadataRule,
    classes: FieldClassMap,
  ): MaskedValue | undefined {
    if (typeof rule === 'object') {
      return isPlainObject(value) ? this.applyAllowlist(value, rule.object, classes) : undefined;
    }

    switch (rule) {
      case SCALAR:
        return isScalarOrNull(value) ? value : undefined;
      case SCALAR_LIST:
        return Array.isArray(value) ? value.filter(isScalar) : undefined;
      case NUMBER_MAP:
        return isPlainObject(value)
          ? Object.fromEntries(
              Object.entries(value).filter(([, v]) => typeof v === 'number') as [string, number][],
            )
          : undefined;
      case CODE_MAP:
        return isPlainObject(value)
          ? Object.fromEntries(
              Object.entries(value).filter(
                (entry): entry is [string, string[]] =>
                  Array.isArray(entry[1]) && entry[1].every((code) => typeof code === 'string'),
              ),
            )
          : undefined;
      case SCALAR_RECORD_LIST:
        return Array.isArray(value)
          ? value
              .filter(isPlainObject)
              .map((record) =>
                Object.fromEntries(
                  Object.entries(record).filter(([, v]) => isScalarOrNull(v)) as [
                    string,
                    Scalar | null,
                  ][],
                ),
              )
          : undefined;
      case MASKED_DATA:
        return isPlainObject(value) ? this.maskCollectedData(value, classes) : undefined;
    }
  }
}
