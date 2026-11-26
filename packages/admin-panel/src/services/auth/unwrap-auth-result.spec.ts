import { describe, expect, it } from 'vitest';
import { ApiError } from '@/services/api/api-error';
import { unwrap } from './unwrap-auth-result';

describe('unwrap', () => {
  it('returns the data of a successful call', async () => {
    await expect(
      unwrap(Promise.resolve({ data: { id: 'x' }, error: null }), 'failed'),
    ).resolves.toEqual({
      id: 'x',
    });
  });

  it("keeps better-auth's status, so a lost session reaches the 401 handling", async () => {
    const call = Promise.resolve({
      data: null,
      error: { message: 'Unauthorized', status: 401, code: 'UNAUTHORIZED' },
    });

    const error = await unwrap(call, 'failed').catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: 'UNAUTHORIZED', message: 'Unauthorized' });
  });

  it('falls back to the given message when better-auth gives none, or returns no data', async () => {
    await expect(
      unwrap(Promise.resolve({ data: null, error: {} }), 'Unable to load.'),
    ).rejects.toThrow('Unable to load.');
    await expect(
      unwrap(Promise.resolve({ data: null, error: null }), 'Unable to load.'),
    ).rejects.toThrow('Unable to load.');
  });
});
