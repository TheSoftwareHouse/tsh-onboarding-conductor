import { describe, expect, it } from 'vitest';
import { AxiosError, type AxiosResponse } from 'axios';
import { ApiError, invalidPayloadError, toApiError } from './api-error';

function axiosFailure(status: number, data: unknown): AxiosError {
  const response = { status, data } as AxiosResponse;
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, response);
}

describe('toApiError', () => {
  it('carries status, code and body from a coded axios error', () => {
    const body = { code: 'SOME_CODE', message: 'SOME_CODE', extra: 1 };

    const error = toApiError(axiosFailure(409, body), 'workflows');

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      name: 'ApiError',
      kind: 'request-failed',
      status: 409,
      code: 'SOME_CODE',
      body,
      message: 'Request failed with status 409.',
    });
  });

  it('gives code null for a Nest body without one', () => {
    const error = toApiError(axiosFailure(400, { statusCode: 400, message: 'bad' }), 'workflows');

    expect(error.code).toBeNull();
    expect(error.status).toBe(400);
  });

  it('gives no status for a non-axios cause and uses its message', () => {
    const error = toApiError(new Error('network down'), 'workflows');

    expect(error.status).toBeUndefined();
    expect(error.body).toBeUndefined();
    expect(error.message).toBe('network down');
  });

  it('uses describeCode only when it returns a string', () => {
    const coded = axiosFailure(409, { code: 'KNOWN' });
    const describe = (code: string): string | undefined =>
      code === 'KNOWN' ? 'Known message' : undefined;

    expect(toApiError(coded, 'x', describe).message).toBe('Known message');
    expect(toApiError(axiosFailure(409, { code: 'OTHER' }), 'x', describe).message).toBe(
      'Request failed with status 409.',
    );
  });
});

describe('invalidPayloadError', () => {
  it('gives kind invalid-payload', () => {
    const error = invalidPayloadError('Malformed.');

    expect(error).toMatchObject({ kind: 'invalid-payload', message: 'Malformed.', code: null });
    expect(error.status).toBeUndefined();
  });
});
