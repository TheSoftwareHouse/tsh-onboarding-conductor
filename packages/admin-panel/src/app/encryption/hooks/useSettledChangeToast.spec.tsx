import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EncryptionKey, EncryptionState } from '@/api/encryption/admin-encryption';
import { showSuccessToast } from '@/components/ui/Toast/toast-manager';
import {
  REENCRYPT_SETTLED_TITLE,
  TOGGLE_SETTLED_TITLE,
  type EncryptionPendingChange,
} from '../constants/encryption-toasts';
import { useSettledChangeToast } from './useSettledChangeToast';

vi.mock('@/components/ui/Toast/toast-manager', () => ({
  showSuccessToast: vi.fn(),
}));

const mockedShowSuccessToast = vi.mocked(showSuccessToast);

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
    reencrypting: false,
    ...overrides,
  };
}

const SETTLED_ON = createState();
const IN_FLIGHT_ON = createState({ keys: [createKey({ active: false, pendingActivation: true })] });
const SETTLED_OFF = createState({ enabled: false, keys: [] });
const IN_FLIGHT_OFF = createState({ enabled: false });
const SETTLED_REENCRYPT = createState({ reencrypting: false });
const IN_FLIGHT_REENCRYPT = createState({ reencrypting: true });

beforeEach(() => {
  mockedShowSuccessToast.mockReset();
});

describe('useSettledChangeToast', () => {
  it('raises nothing when no change is pending', () => {
    const { rerender } = renderHook(({ state }) => useSettledChangeToast(state), {
      initialProps: { state: IN_FLIGHT_ON as EncryptionState | null },
    });

    rerender({ state: SETTLED_ON });

    expect(mockedShowSuccessToast).not.toHaveBeenCalled();
  });

  it.each<[EncryptionPendingChange, EncryptionState, EncryptionState, string]>([
    ['on', IN_FLIGHT_ON, SETTLED_ON, TOGGLE_SETTLED_TITLE.on],
    ['off', IN_FLIGHT_OFF, SETTLED_OFF, TOGGLE_SETTLED_TITLE.off],
    ['reencrypt', IN_FLIGHT_REENCRYPT, SETTLED_REENCRYPT, REENCRYPT_SETTLED_TITLE],
  ])(
    "settles a pending '%s' once the state stops being in flight",
    (change, inFlight, settled, title) => {
      const { result, rerender } = renderHook(({ state }) => useSettledChangeToast(state), {
        initialProps: { state: inFlight as EncryptionState | null },
      });

      act(() => {
        result.current.notifyPending(change, inFlight);
      });
      expect(mockedShowSuccessToast).not.toHaveBeenCalled();

      rerender({ state: settled });

      expect(mockedShowSuccessToast).toHaveBeenCalledExactlyOnceWith(title);
    },
  );

  it("raises the settled toast immediately when the write's own response already reports settled", () => {
    const { result } = renderHook(({ state }) => useSettledChangeToast(state), {
      initialProps: { state: SETTLED_ON as EncryptionState | null },
    });

    act(() => {
      result.current.notifyPending('on', SETTLED_ON);
    });

    expect(mockedShowSuccessToast).toHaveBeenCalledExactlyOnceWith(TOGGLE_SETTLED_TITLE.on);
  });

  it('drops a pending change once a later write supersedes it', () => {
    const { result, rerender } = renderHook(({ state }) => useSettledChangeToast(state), {
      initialProps: { state: IN_FLIGHT_ON as EncryptionState | null },
    });

    act(() => {
      result.current.notifyPending('on', IN_FLIGHT_ON);
    });
    act(() => {
      result.current.notifyPending('off', SETTLED_OFF);
    });
    rerender({ state: SETTLED_OFF });

    expect(mockedShowSuccessToast).toHaveBeenCalledExactlyOnceWith(TOGGLE_SETTLED_TITLE.off);
  });
});
