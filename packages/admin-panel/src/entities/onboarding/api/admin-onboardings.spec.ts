import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAdminOnboardings } from './admin-onboardings';
import { WORKFLOW_VERSION_ERROR_MESSAGE } from '../model/filter-admin-onboardings';
import type { AdminOnboardingSummary } from '../model/admin-onboarding';

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
  vi.stubEnv('VITE_ENGINE_API_BASE_URL', 'http://localhost:3000');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('fetchAdminOnboardings', () => {
  it('requests the admin onboarding path against the VITE_ENGINE_API_BASE_URL origin when no explicit baseUrl is given', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, []));

    const result = await fetchAdminOnboardings({ fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:3000/v1/admin/onboardings');
    expect(result).toEqual({ ok: true, data: [] });
  });

  it('returns an invalid-base-url result and never calls fetch when VITE_ENGINE_API_BASE_URL is not configured', async () => {
    vi.stubEnv('VITE_ENGINE_API_BASE_URL', undefined);
    const fetchImpl = vi.fn();

    const result = await fetchAdminOnboardings({ fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('invalid-base-url');
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns an invalid-base-url result when VITE_ENGINE_API_BASE_URL is blank', async () => {
    vi.stubEnv('VITE_ENGINE_API_BASE_URL', '   ');
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

  it('constructs an unfiltered URL when all filter values are empty or whitespace', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, []));

    await fetchAdminOnboardings({
      baseUrl: 'https://engine.internal',
      fetchImpl,
      filters: {
        status: '',
        workflowId: '   ',
        workflowVersion: '   ',
        currentStep: ' ',
        onboardingId: '\t',
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('https://engine.internal/v1/admin/onboardings');
  });

  it('appends each of the five supported keys once for valid filters', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, []));

    await fetchAdminOnboardings({
      baseUrl: 'https://engine.internal',
      fetchImpl,
      filters: {
        status: 'approved',
        workflowId: 'kyc-basic',
        workflowVersion: '42',
        currentStep: 'collect-documents',
        onboardingId: '018f1e2a-1111-7000-8000-000000000001',
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(url.origin).toBe('https://engine.internal');
    expect(url.pathname).toBe('/v1/admin/onboardings');
    expect(url.searchParams.getAll('status')).toEqual(['approved']);
    expect(url.searchParams.getAll('workflowId')).toEqual(['kyc-basic']);
    expect(url.searchParams.getAll('workflowVersion')).toEqual(['42']);
    expect(url.searchParams.getAll('currentStep')).toEqual(['collect-documents']);
    expect(url.searchParams.getAll('onboardingId')).toEqual([
      '018f1e2a-1111-7000-8000-000000000001',
    ]);
    expect(Array.from(url.searchParams.keys()).sort()).toEqual([
      'currentStep',
      'onboardingId',
      'status',
      'workflowId',
      'workflowVersion',
    ]);
  });

  it('trims text values and relies on URLSearchParams encoding', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, []));

    await fetchAdminOnboardings({
      baseUrl: 'https://engine.internal',
      fetchImpl,
      filters: {
        status: '',
        workflowId: '  kyc basic & review  ',
        workflowVersion: '  7 ',
        currentStep: ' collect/documents? ',
        onboardingId: '  018f1e2a-1111-7000-8000-000000000001  ',
      },
    });

    const requestUrl = fetchImpl.mock.calls[0][0] as string;
    expect(requestUrl).toContain('workflowId=kyc+basic+%26+review');
    expect(requestUrl).toContain('currentStep=collect%2Fdocuments%3F');

    const parsed = new URL(requestUrl);
    expect(parsed.searchParams.get('workflowId')).toBe('kyc basic & review');
    expect(parsed.searchParams.get('workflowVersion')).toBe('7');
    expect(parsed.searchParams.get('currentStep')).toBe('collect/documents?');
    expect(parsed.searchParams.get('onboardingId')).toBe('018f1e2a-1111-7000-8000-000000000001');
  });

  it('returns invalid-input and never calls fetch for a non-empty invalid workflowVersion', async () => {
    const fetchImpl = vi.fn();

    const cases = ['0', '-1', '+1', '1.2', '1e3', 'abc'];
    for (const workflowVersion of cases) {
      const result = await fetchAdminOnboardings({
        baseUrl: 'https://engine.internal',
        fetchImpl,
        filters: {
          status: '',
          workflowId: '',
          workflowVersion,
          currentStep: '',
          onboardingId: '',
        },
      });

      expect(result).toEqual({
        ok: false,
        error: {
          reason: 'invalid-input',
          message: WORKFLOW_VERSION_ERROR_MESSAGE,
        },
      });
    }

    expect(fetchImpl).not.toHaveBeenCalled();
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
