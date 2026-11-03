import { pickStricter } from './field-classifier';
import {
  CSV_OTHER_DATA_COLUMN,
  CSV_SCORE_HEADER_SUFFIX,
  CSV_SYSTEM_COLUMNS,
  FieldClass,
} from './masking.constants';
import type { CsvColumnClasses, FieldClassification, FieldClassMap } from './masking.types';

const PASS: FieldClassification = { class: FieldClass.PASS };
const PASS_NUMBER: FieldClassification = { class: FieldClass.PASS, numericOnly: true };
const DROP: FieldClassification = { class: FieldClass.DROP };

/**
 * The header label the engine's CSV export derives from a key (`firstName` becomes `First name`).
 * Mirrors `humanizeKey` in the engine's `onboardings-csv.ts`; the export's headers are the only
 * link between a column and the field behind it.
 */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => (/^[A-Z]{2,}$/.test(word) ? word : word.toLowerCase()));

  if (words.length === 0) {
    return key;
  }

  const label = words.join(' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Maps each header of an export to how its column is masked: the fixed system columns pass, a
 * collected-field column takes its field's class, an undeclared `<Name> score` column passes when
 * numeric, and `Other data` and every header nothing explains are dropped.
 */
export function buildCsvColumnClasses(
  headers: readonly string[],
  fieldClasses: FieldClassMap,
): CsvColumnClasses {
  const known = new Map<string, FieldClassification>();

  for (const column of CSV_SYSTEM_COLUMNS) {
    known.set(humanizeKey(column), PASS);
  }

  for (const [name, classification] of fieldClasses) {
    const header = humanizeKey(name);
    const existing = known.get(header);
    known.set(header, existing ? pickStricter(existing, classification) : classification);
  }

  known.set(humanizeKey(CSV_OTHER_DATA_COLUMN), DROP);

  return new Map(
    headers.map((header) => [
      header,
      known.get(header) ?? (header.endsWith(CSV_SCORE_HEADER_SUFFIX) ? PASS_NUMBER : DROP),
    ]),
  );
}
