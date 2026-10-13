import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import {
  DEFAULT_ADMIN_ONBOARDING_FILTERS,
  findDraftError,
  isRequestableConnectorId,
  isRequestableParkedBefore,
  isRequestableWorkflowVersion,
  isValidConnectorId,
  isValidWorkflowVersion,
  PARKED_BEFORE_ERROR_MESSAGE,
  PENDING_CONNECTOR_ERROR_MESSAGE,
  PENDING_CONNECTOR_ID_MAX_LENGTH,
  toIsoInstant,
  WORKFLOW_VERSION_ERROR_MESSAGE,
} from './filter-admin-onboardings';

describe('DEFAULT_ADMIN_ONBOARDING_FILTERS', () => {
  it('returns all-blank draft filters at the default page size', () => {
    expect(DEFAULT_ADMIN_ONBOARDING_FILTERS).toEqual({
      status: '',
      workflowId: '',
      workflowVersion: '',
      currentStep: '',
      onboardingId: '',
      parked: false,
      pendingConnectorId: '',
      parkedBefore: '',
      limit: DEFAULT_PAGE_SIZE,
    });
  });

  it('is frozen, since every consumer shares the one object', () => {
    expect(Object.isFrozen(DEFAULT_ADMIN_ONBOARDING_FILTERS)).toBe(true);
  });
});

describe('isRequestableWorkflowVersion', () => {
  it('accepts a blank draft, which names no criterion at all', () => {
    expect(isRequestableWorkflowVersion('')).toBe(true);
    expect(isRequestableWorkflowVersion('   ')).toBe(true);
  });

  it('accepts a positive whole number, with or without the operator’s whitespace', () => {
    expect(isRequestableWorkflowVersion('7')).toBe(true);
    expect(isRequestableWorkflowVersion('  7  ')).toBe(true);
  });

  it('refuses anything the endpoint would not accept', () => {
    for (const value of ['0', '-1', '1.2', 'abc']) {
      expect(isRequestableWorkflowVersion(value)).toBe(false);
    }
  });
});

describe('isValidWorkflowVersion', () => {
  it('accepts positive base-10 whole numbers', () => {
    expect(isValidWorkflowVersion('1')).toBe(true);
    expect(isValidWorkflowVersion('007')).toBe(true);
  });

  it('rejects zero, negatives, decimals and non-numeric values', () => {
    for (const value of ['0', '-1', '1.2', 'abc', '']) {
      expect(isValidWorkflowVersion(value)).toBe(false);
    }
  });
});

describe('isValidConnectorId', () => {
  it('accepts the engine’s connector id shape', () => {
    expect(isValidConnectorId('veriff_kyc')).toBe(true);
    expect(isValidConnectorId('a')).toBe(true);
    expect(isValidConnectorId('a'.repeat(PENDING_CONNECTOR_ID_MAX_LENGTH))).toBe(true);
  });

  it('rejects capitals, a leading digit, hyphens, blank and an over-long id', () => {
    for (const value of [
      'Veriff',
      '1kyc',
      'kyc-basic',
      '',
      'a'.repeat(PENDING_CONNECTOR_ID_MAX_LENGTH + 1),
    ]) {
      expect(isValidConnectorId(value)).toBe(false);
    }
  });
});

describe('isRequestableConnectorId', () => {
  it('accepts a blank draft, which names no criterion at all', () => {
    expect(isRequestableConnectorId('')).toBe(true);
    expect(isRequestableConnectorId('   ')).toBe(true);
  });

  it('accepts a valid id, with or without the operator’s whitespace', () => {
    expect(isRequestableConnectorId('  veriff_kyc  ')).toBe(true);
  });

  it('refuses anything the endpoint would not accept', () => {
    expect(isRequestableConnectorId('Veriff')).toBe(false);
  });
});

describe('toIsoInstant', () => {
  it('resolves a calendar value to the instant it names', () => {
    expect(toIsoInstant('2026-07-01T10:00')).toBe(new Date('2026-07-01T10:00').toISOString());
  });

  it('returns null for a value that names no instant', () => {
    expect(toIsoInstant('yesterday')).toBeNull();
  });
});

describe('isRequestableParkedBefore', () => {
  it('accepts a blank draft and a bound the calendar produced', () => {
    expect(isRequestableParkedBefore('')).toBe(true);
    expect(isRequestableParkedBefore('2026-07-01T10:00')).toBe(true);
  });

  it('refuses a bound that names no instant', () => {
    expect(isRequestableParkedBefore('yesterday')).toBe(false);
  });
});

describe('findDraftError', () => {
  it('reports nothing for the default draft', () => {
    expect(findDraftError(DEFAULT_ADMIN_ONBOARDING_FILTERS)).toBeNull();
  });

  it('names the refused criterion, the version first', () => {
    expect(findDraftError({ ...DEFAULT_ADMIN_ONBOARDING_FILTERS, workflowVersion: 'abc' })).toEqual(
      { field: 'workflowVersion', message: WORKFLOW_VERSION_ERROR_MESSAGE },
    );
    expect(
      findDraftError({ ...DEFAULT_ADMIN_ONBOARDING_FILTERS, pendingConnectorId: 'Veriff' }),
    ).toEqual({ field: 'pendingConnectorId', message: PENDING_CONNECTOR_ERROR_MESSAGE });
    expect(
      findDraftError({ ...DEFAULT_ADMIN_ONBOARDING_FILTERS, parkedBefore: 'yesterday' }),
    ).toEqual({ field: 'parkedBefore', message: PARKED_BEFORE_ERROR_MESSAGE });
    expect(
      findDraftError({
        ...DEFAULT_ADMIN_ONBOARDING_FILTERS,
        workflowVersion: 'abc',
        pendingConnectorId: 'Veriff',
      }),
    ).toEqual({ field: 'workflowVersion', message: WORKFLOW_VERSION_ERROR_MESSAGE });
  });
});
