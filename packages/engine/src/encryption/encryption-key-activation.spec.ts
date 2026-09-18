import {
  isKeyActive,
  isKeyPendingActivation,
  resolveActiveKeyId,
} from './encryption-key-activation';
import { EncryptionKeyEntity } from './entity/encryption-key.entity';

const REFRESH_INTERVAL_MS = 15000;

function row(overrides: Partial<EncryptionKeyEntity> & { id: string }): EncryptionKeyEntity {
  return Object.assign(new EncryptionKeyEntity(), {
    wrappedKey: 'wrapped-material',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    createdBy: null,
    activatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  });
}

/** How `EncryptionAdminService.addKey` builds the two rows a rotation touches. */
function rotate(
  outgoing: EncryptionKeyEntity,
  incomingId: string,
  rotatedAt: Date,
): { outgoing: EncryptionKeyEntity; incoming: EncryptionKeyEntity } {
  const graceThreshold = new Date(rotatedAt.getTime() + REFRESH_INTERVAL_MS);

  return {
    outgoing: row({ ...outgoing, deletedAt: graceThreshold }),
    incoming: row({ id: incomingId, activatedAt: graceThreshold, deletedAt: null }),
  };
}

describe('encryption key activation — exactly one active key at every instant', () => {
  it('is active from its own activatedAt onward when it has never been superseded', () => {
    const key = row({ id: 'key-1', activatedAt: new Date('2026-01-01T00:00:00.000Z') });

    expect(isKeyActive(key, new Date('2026-01-01T00:00:00.000Z'))).toBe(true);
    expect(isKeyActive(key, new Date('2026-06-01T00:00:00.000Z'))).toBe(true);
    expect(isKeyActive(key, new Date('2025-12-31T23:59:59.999Z'))).toBe(false);
  });

  describe('a single rotation', () => {
    const rotatedAt = new Date('2026-03-01T00:00:00.000Z');
    const before = row({ id: 'key-a', activatedAt: new Date('2026-01-01T00:00:00.000Z') });
    const { outgoing, incoming } = rotate(before, 'key-b', rotatedAt);
    const threshold = incoming.activatedAt; // === outgoing.deletedAt, by construction

    it('keeps the outgoing key active for the whole grace window, never the incoming one', () => {
      for (const offsetMs of [0, 1, REFRESH_INTERVAL_MS / 2, REFRESH_INTERVAL_MS - 1]) {
        const instant = new Date(rotatedAt.getTime() + offsetMs);

        expect(isKeyActive(outgoing, instant)).toBe(true);
        expect(isKeyActive(incoming, instant)).toBe(false);
        expect(isKeyPendingActivation(incoming, instant)).toBe(true);
        expect(resolveActiveKeyId([outgoing, incoming], instant)).toBe(outgoing.id);
      }
    });

    it('flips atomically at the threshold: the incoming key becomes active the same instant the outgoing one stops', () => {
      const justBefore = new Date(threshold.getTime() - 1);
      const atThreshold = threshold;

      expect(isKeyActive(outgoing, justBefore)).toBe(true);
      expect(isKeyActive(incoming, justBefore)).toBe(false);

      expect(isKeyActive(outgoing, atThreshold)).toBe(false);
      expect(isKeyActive(incoming, atThreshold)).toBe(true);
      expect(isKeyPendingActivation(incoming, atThreshold)).toBe(false);
      expect(resolveActiveKeyId([outgoing, incoming], atThreshold)).toBe(incoming.id);
    });

    it('keeps the incoming key active indefinitely afterward', () => {
      const longAfter = new Date(threshold.getTime() + 1000 * REFRESH_INTERVAL_MS);

      expect(isKeyActive(outgoing, longAfter)).toBe(false);
      expect(isKeyActive(incoming, longAfter)).toBe(true);
      expect(resolveActiveKeyId([outgoing, incoming], longAfter)).toBe(incoming.id);
    });

    it('never admits both, or neither, at any sampled instant across the whole window', () => {
      const start = rotatedAt.getTime() - REFRESH_INTERVAL_MS;
      const end = threshold.getTime() + REFRESH_INTERVAL_MS;

      for (let t = start; t <= end; t += 500) {
        const instant = new Date(t);
        const activeCount = [outgoing, incoming].filter((key) => isKeyActive(key, instant)).length;

        expect(activeCount).toBe(1);
      }
    });
  });

  describe('a second rotation issued before the first grace window elapses', () => {
    // key-a is active; a rotation to key-b starts at t0; before key-b ever activates, a second
    // rotation to key-c is issued at t1. `addKey` always soft-deletes whichever row currently
    // holds `deletedAt IS NULL` — key-b, the *previous* rotation's incoming key, not key-a — so
    // this must compose into a clean hand-off chain rather than a gap or an overlap.
    const t0 = new Date('2026-03-01T00:00:00.000Z');
    const t1 = new Date(t0.getTime() + REFRESH_INTERVAL_MS / 2); // still inside key-b's grace window

    const keyA = row({ id: 'key-a', activatedAt: new Date('2026-01-01T00:00:00.000Z') });
    const firstRotation = rotate(keyA, 'key-b', t0);
    // The second rotation's `addKey` call finds `firstRotation.incoming` (key-b) as "the active
    // row" (deletedAt IS NULL) and soft-deletes *that* one — exactly what `rotate` does when
    // handed it as the "outgoing" row.
    const secondRotation = rotate(firstRotation.incoming, 'key-c', t1);

    const keyAFinal = firstRotation.outgoing; // key-a, deletedAt = t0 + interval
    const keyBFinal = secondRotation.outgoing; // key-b, deletedAt = t1 + interval (overwritten)
    const keyC = secondRotation.incoming; // deletedAt = null, activatedAt = t1 + interval

    const allRows = [keyAFinal, keyBFinal, keyC];

    it('keeps key-a active until t0 + interval, unaffected by the second rotation', () => {
      const justBeforeKeyAExpires = new Date(keyAFinal.deletedAt!.getTime() - 1);

      expect(resolveActiveKeyId(allRows, justBeforeKeyAExpires)).toBe('key-a');
    });

    it('activates key-b exactly on schedule (t0 + interval) even though it was superseded before it ever activated', () => {
      const whenKeyBWasScheduledToActivate = keyAFinal.deletedAt as Date;

      expect(resolveActiveKeyId(allRows, whenKeyBWasScheduledToActivate)).toBe('key-b');
    });

    it('keeps key-b active until t1 + interval, then hands off to key-c', () => {
      const justBeforeKeyBExpires = new Date(keyBFinal.deletedAt!.getTime() - 1);
      const atKeyCActivation = keyBFinal.deletedAt as Date;

      expect(resolveActiveKeyId(allRows, justBeforeKeyBExpires)).toBe('key-b');
      expect(resolveActiveKeyId(allRows, atKeyCActivation)).toBe('key-c');
    });

    it('never admits zero or two active keys at any sampled instant across both rotations', () => {
      const start = t0.getTime() - REFRESH_INTERVAL_MS;
      const end = keyC.activatedAt.getTime() + REFRESH_INTERVAL_MS;

      for (let t = start; t <= end; t += 250) {
        const instant = new Date(t);
        const activeCount = allRows.filter((key) => isKeyActive(key, instant)).length;

        expect(activeCount).toBe(1);
      }
    });
  });

  describe('resolveActiveKeyId', () => {
    it('returns null when no row is active yet (e.g. an empty table)', () => {
      expect(resolveActiveKeyId([], new Date())).toBeNull();
    });
  });

  describe('isKeyPendingActivation', () => {
    it('is false for a key that is already active', () => {
      const key = row({ id: 'key-1', activatedAt: new Date('2026-01-01T00:00:00.000Z') });

      expect(isKeyPendingActivation(key, new Date('2026-06-01T00:00:00.000Z'))).toBe(false);
    });

    it('is false for a superseded key whose activatedAt is in the past', () => {
      const key = row({
        id: 'key-1',
        activatedAt: new Date('2026-01-01T00:00:00.000Z'),
        deletedAt: new Date('2026-02-01T00:00:00.000Z'),
      });

      expect(isKeyPendingActivation(key, new Date('2026-01-15T00:00:00.000Z'))).toBe(false);
    });

    it('is true only for the row waiting to take over', () => {
      const key = row({
        id: 'key-1',
        activatedAt: new Date('2026-06-01T00:00:00.000Z'),
        deletedAt: null,
      });

      expect(isKeyPendingActivation(key, new Date('2026-01-01T00:00:00.000Z'))).toBe(true);
    });
  });
});
