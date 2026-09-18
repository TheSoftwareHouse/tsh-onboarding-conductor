import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addEncryptionKey,
  AddEncryptionKeyError,
  fetchEncryptionKeys,
  EncryptionKeysFetchError,
} from './admin-encryption-keys';
import { ENCRYPTION_KEY_ENDPOINTS } from '../constants/endpoints';
import type { EncryptionKey } from '../types/encryption-key';

const { mockedGet, mockedPost } = vi.hoisted(() => {
  const mockedGet = vi.fn();
  const mockedPost = vi.fn();
  return { mockedGet, mockedPost };
});

vi.mock('@/services/api/http-client', () => ({
  httpClient: { get: mockedGet, post: mockedPost },
}));

const ACTIVE_KEY: EncryptionKey = {
  id: '01a0ae98-ad4d-72ac-9f17-74e08efa00fd',
  createdAt: '2026-09-17T09:00:36.572Z',
  createdBy: 'unknown',
  activatedAt: '2026-09-17T09:00:36.557Z',
  deletedAt: null,
  active: true,
};

const SUPERSEDED_KEY: EncryptionKey = {
  id: '01a0ae98-73f5-7287-b137-2b6ee967156e',
  createdAt: '2026-09-17T09:00:21.880Z',
  createdBy: null,
  activatedAt: '2026-09-17T09:00:21.878Z',
  deletedAt: '2026-09-17T09:00:36.575Z',
  active: false,
};

function listResponse(
  keys: unknown[],
  reEncryption: unknown = { pending: 0, total: 0 },
): {
  data: unknown;
} {
  return { data: { keys, reEncryption } };
}

beforeEach(() => {
  mockedGet.mockReset();
  mockedPost.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchEncryptionKeys', () => {
  it('requests the admin encryption keys path against the shared http client', async () => {
    mockedGet.mockResolvedValueOnce(listResponse([ACTIVE_KEY]));

    await fetchEncryptionKeys();

    expect(mockedGet).toHaveBeenCalledWith(ENCRYPTION_KEY_ENDPOINTS.adminEncryptionKeys);
  });

  it('returns the keys projected onto the declared fields, and the re-encryption progress', async () => {
    mockedGet.mockResolvedValueOnce(
      listResponse([ACTIVE_KEY, SUPERSEDED_KEY], { pending: 3, total: 10 }),
    );

    await expect(fetchEncryptionKeys()).resolves.toEqual({
      keys: [ACTIVE_KEY, SUPERSEDED_KEY],
      reEncryption: { pending: 3, total: 10 },
    });
  });

  it('reports no keys and no progress when encryption is disabled', async () => {
    mockedGet.mockResolvedValueOnce(listResponse([]));

    await expect(fetchEncryptionKeys()).resolves.toEqual({
      keys: [],
      reEncryption: { pending: 0, total: 0 },
    });
  });

  it('drops a field the endpoint may add beyond the ones the list renders', async () => {
    mockedGet.mockResolvedValueOnce(
      listResponse([{ ...ACTIVE_KEY, wrappedKey: 'do-not-render-me' }]),
    );

    const result = await fetchEncryptionKeys();

    expect(result.keys).toEqual([ACTIVE_KEY]);
    expect(result.keys[0]).not.toHaveProperty('wrappedKey');
  });

  it('reports a malformed key rather than rendering a partial list', async () => {
    mockedGet.mockResolvedValueOnce(listResponse([{ ...ACTIVE_KEY, active: undefined }]));

    await expect(fetchEncryptionKeys()).rejects.toMatchObject({
      reason: 'invalid-payload' satisfies EncryptionKeysFetchError['reason'],
      message: 'Response contains a malformed encryption key.',
    });
  });

  it.each([
    [401, 'Your session is no longer accepted by the engine. Sign in again.'],
    [403, 'Your account is signed in but is not assigned a role that may view encryption keys.'],
    [500, 'Request failed with status 500.'],
  ])(
    'carries the status and the describeRequestFailure message for a %s response',
    async (status, message) => {
      const axiosError = new AxiosError(`Request failed with status code ${status}`);
      axiosError.response = { status } as AxiosError['response'];
      mockedGet.mockRejectedValueOnce(axiosError);

      await expect(fetchEncryptionKeys()).rejects.toMatchObject({
        reason: 'request-failed',
        status,
        message,
      });
    },
  );

  it('surfaces the underlying message when the request never reached the engine', async () => {
    mockedGet.mockRejectedValueOnce(new Error('Network Error'));

    await expect(fetchEncryptionKeys()).rejects.toMatchObject({
      reason: 'request-failed',
      message: 'Network Error',
    });
  });
});

describe('addEncryptionKey', () => {
  it('sends a POST with no body against the shared http client', async () => {
    mockedPost.mockResolvedValueOnce({ data: { id: ACTIVE_KEY.id } });

    await addEncryptionKey();

    expect(mockedPost).toHaveBeenCalledWith(ENCRYPTION_KEY_ENDPOINTS.adminEncryptionKeys);
  });

  it('returns the new key id', async () => {
    mockedPost.mockResolvedValueOnce({ data: { id: ACTIVE_KEY.id } });

    await expect(addEncryptionKey()).resolves.toBe(ACTIVE_KEY.id);
  });

  it('reports a malformed response rather than a blank success', async () => {
    mockedPost.mockResolvedValueOnce({ data: {} });

    await expect(addEncryptionKey()).rejects.toMatchObject({
      message: 'Response contains a malformed encryption key id.',
    });
  });

  it('explains a 409 ENCRYPTION_DISABLED response as encryption being off, not a generic failure', async () => {
    const axiosError = new AxiosError('Request failed with status code 409');
    axiosError.response = {
      status: 409,
      data: { code: 'ENCRYPTION_DISABLED', message: 'Encryption is not enabled.' },
    } as AxiosError['response'];
    mockedPost.mockRejectedValueOnce(axiosError);

    await expect(addEncryptionKey()).rejects.toMatchObject({
      disabled: true,
      status: 409,
      message: 'Encryption is not enabled, so there is no key to rotate.',
    } satisfies Partial<AddEncryptionKeyError>);
  });

  it('does not mark an unrelated 409 as encryption being disabled', async () => {
    const axiosError = new AxiosError('Request failed with status code 409');
    axiosError.response = {
      status: 409,
      data: { code: 'SOMETHING_ELSE' },
    } as AxiosError['response'];
    mockedPost.mockRejectedValueOnce(axiosError);

    await expect(addEncryptionKey()).rejects.toMatchObject({ disabled: false, status: 409 });
  });

  it.each([
    [401, 'Your session is no longer accepted by the engine. Sign in again.'],
    [500, 'Request failed with status 500.'],
  ])('carries the describeRequestFailure message for a %s response', async (status, message) => {
    const axiosError = new AxiosError(`Request failed with status code ${status}`);
    axiosError.response = { status } as AxiosError['response'];
    mockedPost.mockRejectedValueOnce(axiosError);

    await expect(addEncryptionKey()).rejects.toMatchObject({ disabled: false, status, message });
  });
});
