import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAdminOnboardings } from './admin-onboardings';
import type { AdminOnboardingSummary } from '../types/admin-onboarding';

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

function invalidJsonResponse(status: number): Response {
  return {
    status,
    json: () => Promise.reject(new SyntaxError('Unexpected token in JSON')),
  } as Response;
}

const VALID_RECORD: AdminOnboardingSummary = {
  onboardingId: '018f1e2a-1111-7000-8000-000000000001',
  workflowId: 'kyc-basic',
  workflowVersion: 1,
  status: 'awaiting_user',
  currentStep: 'collect-documents',
  expiresAt: '2026-08-01T00:00:00.000Z',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-02T00:00:00.000Z',
  completedAt: null,
};

beforeEach(() => {
  vi.stubEnv('VITE_ENGINE_BASE_URL', 'http://localhost:3000');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('fetchAdminOnboardings', () => {
  it('requests the admin onboarding path against the VITE_ENGINE_BASE_URL origin when no explicit baseUrl is given', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, []));

    const result = await fetchAdminOnboardings({ fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:3000/v1/admin/onboardings');
    expect(result).toEqual({ ok: true, data: [] });
  });

  it('returns an invalid-base-url result and never calls fetch when VITE_ENGINE_BASE_URL is not configured', async () => {
    vi.stubEnv('VITE_ENGINE_BASE_URL', undefined);
    const fetchImpl = vi.fn();

    const result = await fetchAdminOnboardings({ fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('invalid-base-url');
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns an invalid-base-url result when VITE_ENGINE_BASE_URL is blank', async () => {
    vi.stubEnv('VITE_ENGINE_BASE_URL', '   ');
    const fetchImpl = vi.fn();

    const result = await fetchAdminOnboardings({ fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('invalid-base-url');
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('accepts valid http and https origins and constructs the exact engine URL without query params', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, []));

    await fetchAdminOnboardings({ baseUrl: 'https://engine.internal', fetchImpl });
    await fetchAdminOnboardings({ baseUrl: 'http://localhost:3000', fetchImpl });

    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'https://engine.internal/v1/admin/onboardings');
    expect(fetchImpl).toHaveBeenNthCalledWith(2, 'http://localhost:3000/v1/admin/onboardings');
    expect(fetchImpl.mock.calls[0][1]).toBeUndefined();
    expect(fetchImpl.mock.calls[1][1]).toBeUndefined();
  });

  it('projects records onto the nine lifecycle-safe fields and excludes context', async () => {
    const rawRecord = { ...VALID_RECORD, context: { secret: 'do-not-render' } };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, [rawRecord]));

    const result = await fetchAdminOnboardings({ fetchImpl });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([VALID_RECORD]);
      expect(result.data[0]).not.toHaveProperty('context');
      expect(Object.keys(result.data[0])).toEqual([
        'onboardingId',
        'workflowId',
        'workflowVersion',
        'status',
        'currentStep',
        'expiresAt',
        'createdAt',
        'updatedAt',
        'completedAt',
      ]);
    }
  });

  it('returns a http-error result for a non-200 response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, []));

    const result = await fetchAdminOnboardings({ fetchImpl });

    expect(result).toEqual({
      ok: false,
      error: {
        reason: 'http-error',
        message: 'Request failed with status 500.',
        status: 500,
      },
    });
  });

  it('returns an invalid-json result when the response body cannot be parsed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(invalidJsonResponse(200));

    const result = await fetchAdminOnboardings({ fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('invalid-json');
    }
  });

  it('returns an invalid-payload result for a non-array response body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { records: [] }));

    const result = await fetchAdminOnboardings({ fetchImpl });

    expect(result).toEqual({
      ok: false,
      error: {
        reason: 'invalid-payload',
        message: 'Response payload is not an array.',
      },
    });
  });

  it('returns an invalid-payload result when a record is missing a required field', async () => {
    const malformed: Record<string, unknown> = { ...VALID_RECORD };
    delete malformed.onboardingId;
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, [malformed]));

    const result = await fetchAdminOnboardings({ fetchImpl });

    expect(result).toEqual({
      ok: false,
      error: {
        reason: 'invalid-payload',
        message: 'Response contains a malformed onboarding record.',
      },
    });
  });

  it('returns an invalid-payload result when workflowVersion is not a positive integer', async () => {
    const malformed = { ...VALID_RECORD, workflowVersion: 0 };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, [malformed]));

    const result = await fetchAdminOnboardings({ fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('invalid-payload');
    }
  });

  it('returns an invalid-payload result when a record is not an object', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, [null]));

    const result = await fetchAdminOnboardings({ fetchImpl });

    expect(result).toEqual({
      ok: false,
      error: {
        reason: 'invalid-payload',
        message: 'Response contains a malformed onboarding record.',
      },
    });
  });

  it('returns a network-error result when the fetch implementation rejects', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await fetchAdminOnboardings({ fetchImpl });

    expect(result).toEqual({
      ok: false,
      error: {
        reason: 'network-error',
        message: 'Failed to fetch',
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:3000/v1/admin/onboardings');
  });

  it('rejects an invalid base URL before issuing a request', async () => {
    const fetchImpl = vi.fn();

    const result = await fetchAdminOnboardings({
      baseUrl: 'https://engine.internal/path?x=1',
      fetchImpl,
    });
    const result2 = await fetchAdminOnboardings({ baseUrl: 'ftp://engine.internal', fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('invalid-base-url');
    }
    expect(result2.ok).toBe(false);
    if (!result2.ok) {
      expect(result2.error.reason).toBe('invalid-base-url');
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
