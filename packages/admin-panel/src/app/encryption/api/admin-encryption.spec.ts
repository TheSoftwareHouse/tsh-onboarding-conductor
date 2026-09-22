import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addEncryptionKey,
  EncryptionFetchError,
  EncryptionWriteError,
  fetchEncryptionState,
  setEncryptionEnabled,
  setEncryptionRotationInterval,
} from './admin-encryption';
import { ENCRYPTION_ENDPOINTS } from '../constants/endpoints';
import type { EncryptionKey, EncryptionState } from '../types/encryption';

const { mockedGet, mockedPatch, mockedPost } = vi.hoisted(() => {
  const mockedGet = vi.fn();
  const mockedPatch = vi.fn();
  const mockedPost = vi.fn();
  return { mockedGet, mockedPatch, mockedPost };
});

vi.mock('@/services/api/http-client', () => ({
  httpClient: { get: mockedGet, patch: mockedPatch, post: mockedPost },
}));

const ACTIVE_KEY: EncryptionKey = {
  id: '01a0ae98-ad4d-72ac-9f17-74e08efa00fd',
  createdAt: '2026-09-17T09:00:36.572Z',
  createdBy: 'operator-oid',
  activatedAt: '2026-09-17T09:00:51.557Z',
  deletedAt: null,
  active: true,
  pendingActivation: false,
};

const SUPERSEDED_KEY: EncryptionKey = {
  id: '01a0ae98-73f5-7287-b137-2b6ee967156e',
  createdAt: '2026-09-17T09:00:21.880Z',
  createdBy: null,
  activatedAt: '2026-09-17T09:00:21.878Z',
  deletedAt: '2026-09-17T09:00:36.575Z',
  active: false,
  pendingActivation: false,
};

const ON_STATE: EncryptionState = {
  enabled: true,
  keyConfigured: true,
  keys: [ACTIVE_KEY, SUPERSEDED_KEY],
  rotation: { interval: '1w', nextRotationAt: '2026-09-24T09:00:36.572Z' },
  progress: { pending: 3, total: 12 },
  reencrypting: false,
};

function stateResponse(overrides: Record<string, unknown> = {}): { data: unknown } {
  return { data: { ...ON_STATE, ...overrides } };
}

function axiosFailure(status: number, data?: unknown): AxiosError {
  const axiosError = new AxiosError(`Request failed with status code ${status}`);
  axiosError.response = { status, data } as AxiosError['response'];
  return axiosError;
}

const AUTH_FAILURES: [number, string][] = [
  [401, 'Your session is no longer accepted by the engine. Sign in again.'],
  [403, 'Your account is signed in but is not assigned a role that may view encryption settings.'],
  [
    503,
    'The engine cannot verify sign-ins right now. This is not a problem with your account — try again shortly.',
  ],
  [500, 'Request failed with status 500.'],
];

beforeEach(() => {
  mockedGet.mockReset();
  mockedPatch.mockReset();
  mockedPost.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchEncryptionState', () => {
  it('requests the admin encryption path against the shared http client', async () => {
    mockedGet.mockResolvedValueOnce(stateResponse());

    await fetchEncryptionState();

    expect(mockedGet).toHaveBeenCalledWith(ENCRYPTION_ENDPOINTS.adminEncryption);
  });

  it('returns the state with each key projected onto the declared fields', async () => {
    mockedGet.mockResolvedValueOnce(stateResponse());

    await expect(fetchEncryptionState()).resolves.toEqual(ON_STATE);
  });

  it('reports the off state with no keys and nothing pending', async () => {
    mockedGet.mockResolvedValueOnce(
      stateResponse({
        enabled: false,
        keys: [],
        rotation: { interval: null, nextRotationAt: null },
        progress: { pending: 0, total: 12 },
      }),
    );

    await expect(fetchEncryptionState()).resolves.toEqual({
      enabled: false,
      keyConfigured: true,
      keys: [],
      rotation: { interval: null, nextRotationAt: null },
      progress: { pending: 0, total: 12 },
      reencrypting: false,
    });
  });

  it('drops fields the endpoint may add beyond the ones the panel renders', async () => {
    mockedGet.mockResolvedValueOnce(
      stateResponse({
        keys: [{ ...ACTIVE_KEY, wrappedKey: 'do-not-render-me' }],
        kekFingerprint: 'nor-me',
        rotation: {
          interval: '1w',
          nextRotationAt: '2026-09-24T09:00:36.572Z',
          rotationsSoFar: 'nor-me',
        },
        progress: { pending: 0, total: 1, startedAt: 'nor-me' },
      }),
    );

    const result = await fetchEncryptionState();

    expect(result).toEqual({ ...ON_STATE, keys: [ACTIVE_KEY], progress: { pending: 0, total: 1 } });
    expect(result).not.toHaveProperty('kekFingerprint');
    expect(result.keys[0]).not.toHaveProperty('wrappedKey');
    expect(result.progress).not.toHaveProperty('startedAt');
  });

  it('reports a malformed key rather than rendering a partial history', async () => {
    mockedGet.mockResolvedValueOnce(
      stateResponse({ keys: [{ ...ACTIVE_KEY, pendingActivation: undefined }] }),
    );

    await expect(fetchEncryptionState()).rejects.toMatchObject({
      reason: 'invalid-payload' satisfies EncryptionFetchError['reason'],
      message: 'Response contains malformed encryption settings.',
    });
  });

  it('reports a payload missing a top-level field as malformed', async () => {
    mockedGet.mockResolvedValueOnce(stateResponse({ keyConfigured: undefined }));

    await expect(fetchEncryptionState()).rejects.toMatchObject({
      reason: 'invalid-payload',
    });
  });

  it.each(AUTH_FAILURES)(
    'carries the status and the describeRequestFailure message for a %s response',
    async (status, message) => {
      mockedGet.mockRejectedValueOnce(axiosFailure(status));

      await expect(fetchEncryptionState()).rejects.toMatchObject({
        reason: 'request-failed',
        status,
        message,
      });
    },
  );

  it('surfaces the underlying message when the request never reached the engine', async () => {
    mockedGet.mockRejectedValueOnce(new Error('Network Error'));

    await expect(fetchEncryptionState()).rejects.toMatchObject({
      reason: 'request-failed',
      message: 'Network Error',
    });
  });
});

describe('setEncryptionRotationInterval', () => {
  it('sends a PATCH to the rotation path with the chosen interval', async () => {
    mockedPatch.mockResolvedValueOnce(stateResponse());

    await setEncryptionRotationInterval('48h');

    expect(mockedPatch).toHaveBeenCalledWith(ENCRYPTION_ENDPOINTS.adminEncryptionRotation, {
      interval: '48h',
    });
  });

  it('sends null to stop rotating automatically, never an omitted field', async () => {
    mockedPatch.mockResolvedValueOnce(
      stateResponse({ rotation: { interval: null, nextRotationAt: null } }),
    );

    const state = await setEncryptionRotationInterval(null);

    expect(mockedPatch).toHaveBeenCalledWith(ENCRYPTION_ENDPOINTS.adminEncryptionRotation, {
      interval: null,
    });
    expect(state.rotation).toEqual({ interval: null, nextRotationAt: null });
  });

  it('returns the resulting state, projected like the GET', async () => {
    mockedPatch.mockResolvedValueOnce(
      stateResponse({ rotation: { interval: '1mo', nextRotationAt: '2026-10-17T09:00:36.572Z' } }),
    );

    await expect(setEncryptionRotationInterval('1mo')).resolves.toEqual({
      ...ON_STATE,
      rotation: { interval: '1mo', nextRotationAt: '2026-10-17T09:00:36.572Z' },
    });
  });

  it('rejects an interval the engine never offered rather than rendering it', async () => {
    mockedPatch.mockResolvedValueOnce(
      stateResponse({ rotation: { interval: '3d', nextRotationAt: null } }),
    );

    await expect(setEncryptionRotationInterval('1w')).rejects.toMatchObject({
      name: 'EncryptionWriteError',
      message: 'Response contains malformed encryption settings.',
    });
  });

  it('explains a 409 ENCRYPTION_DISABLED as there being no key to schedule', async () => {
    mockedPatch.mockRejectedValueOnce(axiosFailure(409, { code: 'ENCRYPTION_DISABLED' }));

    await expect(setEncryptionRotationInterval('1w')).rejects.toMatchObject({
      code: 'ENCRYPTION_DISABLED',
      status: 409,
      message: 'Encryption is turned off, so there is no key to rotate.',
    } satisfies Partial<EncryptionWriteError>);
  });
});

describe('setEncryptionEnabled', () => {
  it.each([true, false])('sends a PATCH with { enabled: %s } as its body', async (enabled) => {
    mockedPatch.mockResolvedValueOnce(stateResponse({ enabled }));

    await setEncryptionEnabled(enabled);

    expect(mockedPatch).toHaveBeenCalledWith(ENCRYPTION_ENDPOINTS.adminEncryption, { enabled });
  });

  it('returns the new state the engine answers with, projected like the GET', async () => {
    mockedPatch.mockResolvedValueOnce(
      stateResponse({
        enabled: false,
        keys: [{ ...SUPERSEDED_KEY, extra: 'dropped' }],
        progress: { pending: 12, total: 12 },
      }),
    );

    await expect(setEncryptionEnabled(false)).resolves.toEqual({
      enabled: false,
      keyConfigured: true,
      keys: [SUPERSEDED_KEY],
      rotation: ON_STATE.rotation,
      progress: { pending: 12, total: 12 },
      reencrypting: false,
    });
  });

  it('reports a malformed response as a write error rather than a blank success', async () => {
    mockedPatch.mockResolvedValueOnce({ data: { enabled: true } });

    await expect(setEncryptionEnabled(true)).rejects.toMatchObject({
      name: 'EncryptionWriteError',
      code: null,
      message: 'Response contains malformed encryption settings.',
    });
  });

  it('explains a 503 ENCRYPTION_KEY_NOT_CONFIGURED as the missing key-encryption key', async () => {
    mockedPatch.mockRejectedValueOnce(
      axiosFailure(503, {
        code: 'ENCRYPTION_KEY_NOT_CONFIGURED',
        message: 'ENCRYPTION_KEY_NOT_CONFIGURED',
      }),
    );

    await expect(setEncryptionEnabled(true)).rejects.toMatchObject({
      code: 'ENCRYPTION_KEY_NOT_CONFIGURED',
      status: 503,
      message:
        'The engine has no ENCRYPTION_KEY configured. Set it and restart the engine before turning encryption on.',
    } satisfies Partial<EncryptionWriteError>);
  });

  it('explains a 409 ENCRYPTION_KEY_RING_CONFLICT as a retryable clash', async () => {
    mockedPatch.mockRejectedValueOnce(axiosFailure(409, { code: 'ENCRYPTION_KEY_RING_CONFLICT' }));

    await expect(setEncryptionEnabled(false)).rejects.toMatchObject({
      code: 'ENCRYPTION_KEY_RING_CONFLICT',
      status: 409,
      message:
        'Another change to the encryption keys landed at the same moment. Refresh and try again.',
    } satisfies Partial<EncryptionWriteError>);
  });

  it('falls back to the generic message for a 409 the engine did not name', async () => {
    mockedPatch.mockRejectedValueOnce(axiosFailure(409, { code: 'SOMETHING_ELSE' }));

    await expect(setEncryptionEnabled(true)).rejects.toMatchObject({
      code: null,
      status: 409,
      message: 'Request failed with status 409.',
    });
  });

  it('reads a 503 without a named code as the token guard being unable to verify sign-ins', async () => {
    mockedPatch.mockRejectedValueOnce(axiosFailure(503));

    await expect(setEncryptionEnabled(true)).rejects.toMatchObject({
      code: null,
      status: 503,
      message:
        'The engine cannot verify sign-ins right now. This is not a problem with your account — try again shortly.',
    });
  });

  it('ignores a named code on a status the engine never sends one with', async () => {
    mockedPatch.mockRejectedValueOnce(axiosFailure(400, { code: 'ENCRYPTION_DISABLED' }));

    await expect(setEncryptionEnabled(true)).rejects.toMatchObject({
      code: null,
      status: 400,
      message: 'Request failed with status 400.',
    });
  });

  it.each(AUTH_FAILURES)(
    'carries the describeRequestFailure message for a %s response',
    async (status, message) => {
      mockedPatch.mockRejectedValueOnce(axiosFailure(status));

      await expect(setEncryptionEnabled(true)).rejects.toMatchObject({
        code: null,
        status,
        message,
      });
    },
  );
});

describe('addEncryptionKey', () => {
  it('sends a POST with no body against the shared http client', async () => {
    mockedPost.mockResolvedValueOnce({ data: { id: ACTIVE_KEY.id } });

    await addEncryptionKey();

    expect(mockedPost).toHaveBeenCalledWith(ENCRYPTION_ENDPOINTS.adminEncryptionKeys);
  });

  it('returns the new key id', async () => {
    mockedPost.mockResolvedValueOnce({ data: { id: ACTIVE_KEY.id } });

    await expect(addEncryptionKey()).resolves.toBe(ACTIVE_KEY.id);
  });

  it('reports a malformed response rather than a blank success', async () => {
    mockedPost.mockResolvedValueOnce({ data: {} });

    await expect(addEncryptionKey()).rejects.toMatchObject({
      code: null,
      message: 'Response contains a malformed encryption key id.',
    });
  });

  it.each([
    [409, 'ENCRYPTION_DISABLED', 'Encryption is turned off, so there is no key to rotate.'],
    [
      409,
      'ENCRYPTION_KEY_RING_CONFLICT',
      'Another change to the encryption keys landed at the same moment. Refresh and try again.',
    ],
    [
      503,
      'ENCRYPTION_KEY_NOT_CONFIGURED',
      'The engine has no ENCRYPTION_KEY configured. Set it and restart the engine before turning encryption on.',
    ],
  ])('explains a %s %s response with its own copy', async (status, code, message) => {
    mockedPost.mockRejectedValueOnce(axiosFailure(status, { code, message: code }));

    await expect(addEncryptionKey()).rejects.toMatchObject({ code, status, message });
  });

  it('does not name an unrelated 409 as one of the known refusals', async () => {
    mockedPost.mockRejectedValueOnce(axiosFailure(409, { code: 'SOMETHING_ELSE' }));

    await expect(addEncryptionKey()).rejects.toMatchObject({
      code: null,
      status: 409,
      message: 'Request failed with status 409.',
    });
  });

  it.each(AUTH_FAILURES)(
    'carries the describeRequestFailure message for a %s response',
    async (status, message) => {
      mockedPost.mockRejectedValueOnce(axiosFailure(status));

      await expect(addEncryptionKey()).rejects.toMatchObject({ code: null, status, message });
    },
  );
});
