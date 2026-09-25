import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onboardingQueries } from './onboarding-queries';
import {
  fetchAdminOnboardingById,
  fetchAdminOnboardings,
  type AdminOnboardingQueryFilters,
  type AdminOnboardingsPage,
  type AdminOnboardingSummary,
} from './admin-onboardings';
import {
  fetchOnboardingTransitions,
  type OnboardingTransitionsTrail,
} from './onboarding-transitions';

vi.mock('./admin-onboardings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./admin-onboardings')>()),
  fetchAdminOnboardings: vi.fn(),
  fetchAdminOnboardingById: vi.fn(),
}));

vi.mock('./onboarding-transitions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./onboarding-transitions')>()),
  fetchOnboardingTransitions: vi.fn(),
}));

const mockedFetchAdminOnboardings = vi.mocked(fetchAdminOnboardings);
const mockedFetchAdminOnboardingById = vi.mocked(fetchAdminOnboardingById);
const mockedFetchOnboardingTransitions = vi.mocked(fetchOnboardingTransitions);

const FILTERS: AdminOnboardingQueryFilters = {
  page: 1,
  limit: 20,
  status: null,
  workflowId: null,
  workflowVersion: null,
  currentStep: null,
  onboardingId: null,
};

const PAGE: AdminOnboardingsPage = {
  records: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
};

const SUMMARY: AdminOnboardingSummary = {
  onboardingId: '018f1e2a-1111-7000-8000-000000000001',
  workflowId: 'kyc-basic',
  workflowVersion: 1,
  status: 'awaiting_user',
  currentStep: 'collect-documents',
  expiresAt: '2026-08-01T00:00:00.000Z',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-02T00:00:00.000Z',
  completedAt: null,
  scores: {},
};

const TRAIL: OnboardingTransitionsTrail = { transitions: [], truncated: false };

beforeEach(() => {
  mockedFetchAdminOnboardings.mockReset();
  mockedFetchAdminOnboardings.mockResolvedValue(PAGE);
  mockedFetchAdminOnboardingById.mockReset();
  mockedFetchAdminOnboardingById.mockResolvedValue(SUMMARY);
  mockedFetchOnboardingTransitions.mockReset();
  mockedFetchOnboardingTransitions.mockResolvedValue(TRAIL);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('onboardingQueries', () => {
  it('builds the list key hierarchy exactly as pinned', () => {
    expect(onboardingQueries.all()).toEqual(['onboardings']);
    expect(onboardingQueries.lists()).toEqual(['onboardings', 'list']);
    expect(onboardingQueries.list(FILTERS).queryKey).toEqual(['onboardings', 'list', FILTERS]);
  });

  it('builds the detail key hierarchy exactly as pinned', () => {
    expect(onboardingQueries.details()).toEqual(['onboardings', 'details']);
    expect(onboardingQueries.detail(SUMMARY.onboardingId).queryKey).toEqual([
      'onboardings',
      'details',
      SUMMARY.onboardingId,
    ]);
  });

  it('fetches the list with the same filters the key was built from, across the module boundary', async () => {
    const options = onboardingQueries.list(FILTERS);

    await options.queryFn?.({
      queryKey: options.queryKey,
      signal: new AbortController().signal,
      meta: undefined,
      client: undefined as never,
    });

    expect(mockedFetchAdminOnboardings).toHaveBeenCalledWith(FILTERS);
  });

  it('fetches the detail with the same id the key was built from, across the module boundary', async () => {
    const options = onboardingQueries.detail(SUMMARY.onboardingId);

    await options.queryFn?.({
      queryKey: options.queryKey,
      signal: new AbortController().signal,
      meta: undefined,
      client: undefined as never,
    });

    expect(mockedFetchAdminOnboardingById).toHaveBeenCalledWith(SUMMARY.onboardingId);
  });

  it('builds the transitions key nested under the detail, exactly as pinned', () => {
    expect(onboardingQueries.transitions(SUMMARY.onboardingId).queryKey).toEqual([
      'onboardings',
      'details',
      SUMMARY.onboardingId,
      'transitions',
    ]);
  });

  it('fetches the transitions with the same id the key was built from, across the module boundary', async () => {
    const options = onboardingQueries.transitions(SUMMARY.onboardingId);

    await options.queryFn?.({
      queryKey: options.queryKey,
      signal: new AbortController().signal,
      meta: undefined,
      client: undefined as never,
    });

    expect(mockedFetchOnboardingTransitions).toHaveBeenCalledWith(SUMMARY.onboardingId);
  });
});
