import {
  DEFAULT_ENCRYPTION_KEY_ROTATION_INTERVAL,
  ENCRYPTION_KEY_ROTATION_INTERVALS,
  ENCRYPTION_KEY_ROTATION_INTERVAL_MS,
  isRotationDue,
  resolveNextRotationAt,
  type EncryptionKeyRotationInterval,
} from './encryption-key-rotation';

const MILLISECONDS_PER_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;
const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');

const row = (rotationInterval: EncryptionKeyRotationInterval | null, createdAt = CREATED_AT) => ({
  createdAt,
  rotationInterval,
});

describe('encryption key rotation schedule', () => {
  it('offers exactly the five intervals the admin panel does, each with a duration', () => {
    expect(ENCRYPTION_KEY_ROTATION_INTERVALS).toEqual(['48h', '96h', '1w', '2w', '1mo']);
    expect(Object.keys(ENCRYPTION_KEY_ROTATION_INTERVAL_MS)).toEqual([
      ...ENCRYPTION_KEY_ROTATION_INTERVALS,
    ]);
  });

  it('measures each interval as the span its name reads as, a month being a fixed 30 days', () => {
    const hours = (count: number) => count * MILLISECONDS_PER_HOUR;
    const days = (count: number) => hours(count * HOURS_PER_DAY);

    expect(ENCRYPTION_KEY_ROTATION_INTERVAL_MS).toEqual({
      '48h': hours(48),
      '96h': hours(96),
      '1w': days(7),
      '2w': days(14),
      '1mo': days(30),
    });
  });

  it('defaults to a week, the interval a key created without an explicit choice carries', () => {
    expect(DEFAULT_ENCRYPTION_KEY_ROTATION_INTERVAL).toBe('1w');
  });

  describe('resolveNextRotationAt', () => {
    it("measures from the key's own creation, not from when the interval was chosen", () => {
      expect(resolveNextRotationAt(row('1w'))).toEqual(new Date('2026-01-08T00:00:00.000Z'));
      expect(resolveNextRotationAt(row('48h'))).toEqual(new Date('2026-01-03T00:00:00.000Z'));
    });

    it('is null for a key carrying no schedule, and for no key at all', () => {
      expect(resolveNextRotationAt(row(null))).toBeNull();
      expect(resolveNextRotationAt(null)).toBeNull();
    });
  });

  describe('isRotationDue', () => {
    it('is due once the interval has elapsed, and at the instant it elapses', () => {
      expect(isRotationDue(row('48h'), new Date('2026-01-02T23:59:59.999Z'))).toBe(false);
      expect(isRotationDue(row('48h'), new Date('2026-01-03T00:00:00.000Z'))).toBe(true);
      expect(isRotationDue(row('48h'), new Date('2026-01-09T00:00:00.000Z'))).toBe(true);
    });

    it('is due at once when the chosen interval is shorter than the key is already old', () => {
      const monthOldKey = row('48h', new Date('2025-12-01T00:00:00.000Z'));

      expect(isRotationDue(monthOldKey, CREATED_AT)).toBe(true);
    });

    it('is never due without a schedule, however old the key is', () => {
      expect(isRotationDue(row(null, new Date('2020-01-01T00:00:00.000Z')), CREATED_AT)).toBe(
        false,
      );
      expect(isRotationDue(null, CREATED_AT)).toBe(false);
    });
  });
});
