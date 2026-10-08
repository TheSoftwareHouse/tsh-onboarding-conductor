import { createLoader } from 'nuqs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { ADMIN_ONBOARDING_STATUSES } from '@/api/onboardings/admin-onboardings';
import { onboardingQueries } from '@/api/onboardings/onboarding-queries';
import {
  adminOnboardingsSearchParams,
  serializeAdminOnboardingsSearch,
  toAdminOnboardingFilters,
  toAdminOnboardingsSearchValues,
  type AdminOnboardingsSearchValues,
} from './admin-onboardings-search-params';
import {
  DEFAULT_ADMIN_ONBOARDING_FILTERS,
  type AdminOnboardingFilters,
} from './filter-admin-onboardings';

const load = createLoader(adminOnboardingsSearchParams);

function defaultState(): AdminOnboardingsSearchValues {
  return {
    status: null,
    workflowId: null,
    workflowVersion: null,
    currentStep: null,
    onboardingId: null,
    parked: null,
    pendingConnectorId: null,
    parkedBefore: null,
    page: DEFAULT_PAGE,
    limit: DEFAULT_PAGE_SIZE,
  };
}

describe('adminOnboardingsSearchParams.status', () => {
  it.each(ADMIN_ONBOARDING_STATUSES)('parses the %s status', (status) => {
    expect(adminOnboardingsSearchParams.status.parse(status)).toBe(status);
  });

  it('falls back to absent (null) for a status this build does not recognize', () => {
    expect(adminOnboardingsSearchParams.status.parse('not-a-status')).toBeNull();
    expect('defaultValue' in adminOnboardingsSearchParams.status).toBe(false);
  });
});

describe('adminOnboardingsSearchParams free-text criteria', () => {
  it.each(['workflowId', 'workflowVersion', 'currentStep', 'onboardingId'] as const)(
    '%s has no default, so it reads as absent (null) rather than blank',
    (key) => {
      expect('defaultValue' in adminOnboardingsSearchParams[key]).toBe(false);
    },
  );

  it('carries an unvalidated free-text value through as-is, trimmed', () => {
    expect(adminOnboardingsSearchParams.workflowId.parse('  kyc-basic  ')).toBe('kyc-basic');
  });
});

describe('adminOnboardingsSearchParams.workflowVersion', () => {
  it('accepts and trims a positive whole number', () => {
    expect(adminOnboardingsSearchParams.workflowVersion.parse(' 7 ')).toBe('7');
  });

  it('falls back to absent (null) for anything that is not a positive whole number', () => {
    for (const value of ['abc', '0', '-1', '1.2', '']) {
      expect(adminOnboardingsSearchParams.workflowVersion.parse(value)).toBeNull();
    }
  });
});

describe('adminOnboardingsSearchParams paging', () => {
  it('reuses the shared page and page-size parsers', () => {
    expect(adminOnboardingsSearchParams.page.defaultValue).toBe(DEFAULT_PAGE);
    expect(adminOnboardingsSearchParams.limit.defaultValue).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe('toAdminOnboardingFilters', () => {
  it('maps an all-absent state to all-blank draft filters', () => {
    expect(toAdminOnboardingFilters(defaultState())).toEqual(DEFAULT_ADMIN_ONBOARDING_FILTERS);
  });

  it('carries a committed criterion through to the control value', () => {
    const state: AdminOnboardingsSearchValues = {
      ...defaultState(),
      status: 'approved',
      workflowId: 'kyc-basic',
    };

    expect(toAdminOnboardingFilters(state)).toEqual({
      ...DEFAULT_ADMIN_ONBOARDING_FILTERS,
      status: 'approved',
      workflowId: 'kyc-basic',
    });
  });
});

describe('toAdminOnboardingsSearchValues', () => {
  it('trims free-text criteria and turns a blank result into null', () => {
    const filters: AdminOnboardingFilters = {
      status: '',
      workflowId: '  kyc-basic  ',
      workflowVersion: '  ',
      currentStep: '',
      onboardingId: ' 018f1e2a-1111-7000-8000-000000000001 ',
      parked: false,
      pendingConnectorId: ' veriff_kyc ',
      parkedBefore: '',
      limit: DEFAULT_PAGE_SIZE,
    };

    expect(toAdminOnboardingsSearchValues(filters, DEFAULT_PAGE)).toEqual({
      status: null,
      workflowId: 'kyc-basic',
      workflowVersion: null,
      currentStep: null,
      onboardingId: '018f1e2a-1111-7000-8000-000000000001',
      parked: null,
      pendingConnectorId: 'veriff_kyc',
      parkedBefore: null,
      page: DEFAULT_PAGE,
      limit: DEFAULT_PAGE_SIZE,
    });
  });

  it('states parked only when the box is ticked, since unticked means no criterion', () => {
    const ticked = toAdminOnboardingsSearchValues(
      { ...DEFAULT_ADMIN_ONBOARDING_FILTERS, parked: true },
      DEFAULT_PAGE,
    );
    const unticked = toAdminOnboardingsSearchValues(DEFAULT_ADMIN_ONBOARDING_FILTERS, DEFAULT_PAGE);

    expect(ticked.parked).toBe(true);
    expect(unticked.parked).toBeNull();
  });
});

describe('adminOnboardingsSearchParams.parked', () => {
  it('parses only the literal true; false is the same as absent', () => {
    expect(adminOnboardingsSearchParams.parked.parse('true')).toBe(true);
    expect(adminOnboardingsSearchParams.parked.parse('false')).toBeNull();
    expect(adminOnboardingsSearchParams.parked.parse('yes')).toBeNull();
  });

  it('serializes to the literal the engine accepts', () => {
    expect(
      serializeAdminOnboardingsSearch(
        { ...DEFAULT_ADMIN_ONBOARDING_FILTERS, parked: true },
        DEFAULT_PAGE,
      ),
    ).toBe('?parked=true');
  });
});

describe('adminOnboardingsSearchParams.pendingConnectorId', () => {
  it('accepts and trims a connector id the engine would accept', () => {
    expect(adminOnboardingsSearchParams.pendingConnectorId.parse(' veriff_kyc ')).toBe(
      'veriff_kyc',
    );
  });

  it('falls back to absent (null) for anything the engine would refuse', () => {
    for (const value of ['Veriff', '1kyc', 'kyc-basic', '', 'a'.repeat(101)]) {
      expect(adminOnboardingsSearchParams.pendingConnectorId.parse(value)).toBeNull();
    }
  });
});

describe('adminOnboardingsSearchParams.parkedBefore', () => {
  it('carries a bound the calendar produced through unparsed', () => {
    expect(adminOnboardingsSearchParams.parkedBefore.parse('2026-07-01T10:00')).toBe(
      '2026-07-01T10:00',
    );
  });

  it('falls back to absent (null) for a value that names no instant', () => {
    expect(adminOnboardingsSearchParams.parkedBefore.parse('yesterday')).toBeNull();
  });
});

describe('serializeAdminOnboardingsSearch', () => {
  it('returns a bare query for the default, unfiltered first page', () => {
    expect(serializeAdminOnboardingsSearch(DEFAULT_ADMIN_ONBOARDING_FILTERS, DEFAULT_PAGE)).toBe(
      '',
    );
  });

  it('carries only the criteria that differ from their defaults', () => {
    const filters: AdminOnboardingFilters = {
      ...DEFAULT_ADMIN_ONBOARDING_FILTERS,
      status: 'approved',
      workflowId: 'kyc-basic',
    };

    expect(serializeAdminOnboardingsSearch(filters, DEFAULT_PAGE)).toBe(
      '?status=approved&workflowId=kyc-basic',
    );
  });

  it('states the page only where it differs from the default', () => {
    expect(serializeAdminOnboardingsSearch(DEFAULT_ADMIN_ONBOARDING_FILTERS, 3)).toBe('?page=3');
  });

  it('states the page size only where it differs from the default', () => {
    const filters: AdminOnboardingFilters = { ...DEFAULT_ADMIN_ONBOARDING_FILTERS, limit: 50 };

    expect(serializeAdminOnboardingsSearch(filters, DEFAULT_PAGE)).toBe('?limit=50');
  });

  it('omits status entirely rather than writing status= when unset', () => {
    const filters: AdminOnboardingFilters = {
      ...DEFAULT_ADMIN_ONBOARDING_FILTERS,
      workflowId: 'kyc-basic',
    };

    const search = serializeAdminOnboardingsSearch(filters, DEFAULT_PAGE);
    expect(search).toBe('?workflowId=kyc-basic');
    expect(search).not.toContain('status=');
  });
});

describe('a URL mixing a valid criterion with a malformed one', () => {
  it('keeps status and workflowId in the query key while workflowVersion falls back to absent', () => {
    const state = load('workflowId=kyc-basic&status=approved&workflowVersion=abc');

    expect(state.workflowVersion).toBeNull();

    // `state` (AdminOnboardingsSearchValues) is the same shape the endpoint's query filters
    // take, so it is handed to the factory directly - no separate projection exists.
    expect(onboardingQueries.list(state).queryKey).toEqual([
      'onboardings',
      'list',
      {
        page: DEFAULT_PAGE,
        limit: DEFAULT_PAGE_SIZE,
        status: 'approved',
        workflowId: 'kyc-basic',
        workflowVersion: null,
        currentStep: null,
        onboardingId: null,
        parked: null,
        pendingConnectorId: null,
        parkedBefore: null,
      },
    ]);
  });
});
