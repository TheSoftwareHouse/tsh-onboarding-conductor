import { describe, expect, it } from 'vitest';
import type { EncryptionKey, EncryptionState } from '../types/encryption';
import { describeEncryptionStatus, isEncryptionChangeInFlight } from './encryption-status';

function createKey(overrides: Partial<EncryptionKey> = {}): EncryptionKey {
  return {
    id: '01a0ae98-ad4d-72ac-9f17-74e08efa00fd',
    createdAt: '2026-09-17T09:00:36.572Z',
    createdBy: 'operator-oid',
    activatedAt: '2026-09-17T09:00:51.557Z',
    deletedAt: null,
    active: true,
    pendingActivation: false,
    ...overrides,
  };
}

function createState(overrides: Partial<EncryptionState> = {}): EncryptionState {
  return {
    enabled: true,
    keyConfigured: true,
    keys: [createKey()],
    rotation: { interval: '1w', nextRotationAt: '2026-09-24T09:00:36.572Z' },
    progress: { pending: 0, total: 12 },
    ...overrides,
  };
}

const retiredKey = createKey({ active: false, deletedAt: '2026-09-17T10:00:00.000Z' });
const pendingKey = createKey({ active: false, pendingActivation: true });

describe('describeEncryptionStatus', () => {
  it.each([
    ['on', createState()],
    ['turning-on', createState({ keys: [pendingKey] })],
    ['turning-off', createState({ enabled: false })],
    ['off', createState({ enabled: false, keys: [retiredKey] })],
    ['off', createState({ enabled: false, keys: [] })],
  ] as const)('reads %s', (expected, state) => {
    expect(describeEncryptionStatus(state)).toBe(expected);
  });
});

describe('isEncryptionChangeInFlight', () => {
  it('is false in a settled state, on or off', () => {
    expect(isEncryptionChangeInFlight(createState())).toBe(false);
    expect(isEncryptionChangeInFlight(createState({ enabled: false, keys: [retiredKey] }))).toBe(
      false,
    );
    expect(isEncryptionChangeInFlight(createState({ enabled: false, keys: [] }))).toBe(false);
  });

  it('is true during either grace window', () => {
    expect(isEncryptionChangeInFlight(createState({ keys: [pendingKey] }))).toBe(true);
    expect(isEncryptionChangeInFlight(createState({ enabled: false }))).toBe(true);
  });

  it('is true while the sweep still has rows to move, in either direction', () => {
    expect(isEncryptionChangeInFlight(createState({ progress: { pending: 3, total: 12 } }))).toBe(
      true,
    );
    expect(
      isEncryptionChangeInFlight(
        createState({ enabled: false, keys: [retiredKey], progress: { pending: 12, total: 12 } }),
      ),
    ).toBe(true);
  });

  it("is true while a rotation's incoming key is pending, even with no rows to move", () => {
    expect(
      isEncryptionChangeInFlight(
        createState({ keys: [pendingKey, createKey()], progress: { pending: 0, total: 0 } }),
      ),
    ).toBe(true);
  });
});
