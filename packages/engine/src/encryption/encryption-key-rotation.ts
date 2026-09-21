import type { EncryptionKeyEntity } from './entity/encryption-key.entity';

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
/** A month with no calendar semantics: this schedule measures a fixed span, never a calendar one. */
const DAYS_PER_MONTH = 30;

const MILLISECONDS_PER_HOUR = MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE * MINUTES_PER_HOUR;
const MILLISECONDS_PER_DAY = MILLISECONDS_PER_HOUR * HOURS_PER_DAY;
const MILLISECONDS_PER_WEEK = MILLISECONDS_PER_DAY * DAYS_PER_WEEK;
const MILLISECONDS_PER_MONTH = MILLISECONDS_PER_DAY * DAYS_PER_MONTH;

const TWO_DAYS_IN_HOURS = 48;
const FOUR_DAYS_IN_HOURS = 96;
const WEEKS_PER_FORTNIGHT = 2;

/**
 * How often an operator may have the engine rotate the encryption key on its own. A closed set,
 * not a free-form duration: the value is stored on the key row, sent over the API and rendered in
 * a select, and each of those three is served by the same five tokens.
 */
export const ENCRYPTION_KEY_ROTATION_INTERVALS = ['48h', '96h', '1w', '2w', '1mo'] as const;

export type EncryptionKeyRotationInterval = (typeof ENCRYPTION_KEY_ROTATION_INTERVALS)[number];

/** Chosen for a key created without an explicit schedule — that is, every key an operator adds. */
export const DEFAULT_ENCRYPTION_KEY_ROTATION_INTERVAL: EncryptionKeyRotationInterval = '1w';

/** Each token as the span it names. `'1mo'` is 30 days, never "the same day next month". */
export const ENCRYPTION_KEY_ROTATION_INTERVAL_MS: Readonly<
  Record<EncryptionKeyRotationInterval, number>
> = {
  '48h': TWO_DAYS_IN_HOURS * MILLISECONDS_PER_HOUR,
  '96h': FOUR_DAYS_IN_HOURS * MILLISECONDS_PER_HOUR,
  '1w': MILLISECONDS_PER_WEEK,
  '2w': WEEKS_PER_FORTNIGHT * MILLISECONDS_PER_WEEK,
  '1mo': MILLISECONDS_PER_MONTH,
};

/** What a rotation decision needs off a key row; a full entity satisfies this too. */
type RotationFields = Pick<EncryptionKeyEntity, 'createdAt' | 'rotationInterval'>;

/**
 * When the schedule `row` carries next falls due, or `null` when it carries none — automatic
 * rotation turned off, or no key at all because encryption is off.
 *
 * Measured from the key's own `createdAt`, not from when the interval was chosen: the schedule
 * says how old the active key may get, so every new key — one an operator adds, and one this
 * schedule itself produces — restarts the countdown simply by existing, with nothing to reset.
 * Shortening the interval below the active key's current age therefore makes it due at once,
 * which is what "rotate every 48 hours" asks for.
 */
export function resolveNextRotationAt(row: RotationFields | null): Date | null {
  if (row === null || row.rotationInterval === null) {
    return null;
  }

  return new Date(
    row.createdAt.getTime() + ENCRYPTION_KEY_ROTATION_INTERVAL_MS[row.rotationInterval],
  );
}

/** Whether `row`'s schedule has come due at `now`; `false` for a row carrying no schedule. */
export function isRotationDue(row: RotationFields | null, now: Date): boolean {
  const nextRotationAt = resolveNextRotationAt(row);

  return nextRotationAt !== null && nextRotationAt.getTime() <= now.getTime();
}
