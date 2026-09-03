import { isAdminOnboardingStatus } from '../types/admin-onboarding';
import type { AdminOnboardingStatus } from '../types/admin-onboarding';
import { DEFAULT_PAGE, type PageSize } from '@/shared/lib/pagination';

export const WORKFLOW_VERSION_ERROR_MESSAGE = 'Enter a whole number greater than zero.';

export const SCORE_ERROR_MESSAGE = 'Enter a whole number.';

/** Columns the list may be ordered by, mirroring what the endpoint accepts. */
export const ADMIN_ONBOARDING_SORT_FIELDS = ['createdAt', 'completedAt', 'score'] as const;

export type AdminOnboardingSortField = (typeof ADMIN_ONBOARDING_SORT_FIELDS)[number];

export const ADMIN_ONBOARDING_SORT_DIRECTIONS = ['asc', 'desc'] as const;

export type AdminOnboardingSortDirection = (typeof ADMIN_ONBOARDING_SORT_DIRECTIONS)[number];

export const DEFAULT_ADMIN_ONBOARDING_SORT_FIELD: AdminOnboardingSortField = 'createdAt';
export const DEFAULT_ADMIN_ONBOARDING_SORT_DIRECTION: AdminOnboardingSortDirection = 'desc';

export function isAdminOnboardingSortField(value: unknown): value is AdminOnboardingSortField {
  return ADMIN_ONBOARDING_SORT_FIELDS.includes(value as AdminOnboardingSortField);
}

export function isAdminOnboardingSortDirection(
  value: unknown,
): value is AdminOnboardingSortDirection {
  return ADMIN_ONBOARDING_SORT_DIRECTIONS.includes(value as AdminOnboardingSortDirection);
}

/** Raw, uncommitted filter control values as entered by the operator. */
export interface AdminOnboardingFilters {
  /** Empty string means "All" (the criterion is disabled). */
  status: '' | AdminOnboardingStatus;
  workflowId: string;
  workflowVersion: string;
  currentStep: string;
  onboardingId: string;
  /** Inclusive score bounds, as typed. A score may be negative, so a leading `-` is accepted. */
  minScore: string;
  maxScore: string;
  sortBy: AdminOnboardingSortField;
  sortDir: AdminOnboardingSortDirection;
  /** Rows per page the operator asked for, offered from the shared `PAGE_SIZES`. */
  limit: PageSize;
}

export interface AdminOnboardingQueryFilters {
  page: number;
  limit: number;
  status?: AdminOnboardingStatus;
  workflowId?: string;
  workflowVersion?: string;
  currentStep?: string;
  onboardingId?: string;
  minScore?: string;
  maxScore?: string;
  sortBy?: AdminOnboardingSortField;
  sortDir?: AdminOnboardingSortDirection;
}

export type NormalizeAdminOnboardingFiltersResult =
  | { ok: true; filters: AdminOnboardingQueryFilters }
  | {
      ok: false;
      error: {
        reason: 'invalid-workflow-version' | 'invalid-min-score' | 'invalid-max-score';
        message: string;
      };
    };

const POSITIVE_INTEGER_PATTERN = /^\d+$/;
/** A score may legitimately be below zero, so the sign is part of the value. */
const SIGNED_INTEGER_PATTERN = /^[+-]?\d+$/;

/**
 * Normalizes draft filter controls into the endpoint's supported query keys.
 * Values are trimmed, blank values are omitted, and workflowVersion is validated.
 *
 * The page window is always sent: the endpoint paginates whether or not it is asked to, so
 * stating the window keeps the request and the pager describing the same page.
 */
export function normalizeAdminOnboardingFilters(
  filters: AdminOnboardingFilters,
  page: number = DEFAULT_PAGE,
): NormalizeAdminOnboardingFiltersResult {
  const normalized: AdminOnboardingQueryFilters = { page, limit: filters.limit };

  if (isAdminOnboardingStatus(filters.status)) {
    normalized.status = filters.status;
  }

  const workflowId = filters.workflowId.trim();
  if (workflowId.length > 0) {
    normalized.workflowId = workflowId;
  }

  const workflowVersion = filters.workflowVersion.trim();
  if (workflowVersion.length > 0) {
    if (!POSITIVE_INTEGER_PATTERN.test(workflowVersion) || Number(workflowVersion) <= 0) {
      return {
        ok: false,
        error: {
          reason: 'invalid-workflow-version',
          message: WORKFLOW_VERSION_ERROR_MESSAGE,
        },
      };
    }
    normalized.workflowVersion = workflowVersion;
  }

  const currentStep = filters.currentStep.trim();
  if (currentStep.length > 0) {
    normalized.currentStep = currentStep;
  }

  const onboardingId = filters.onboardingId.trim();
  if (onboardingId.length > 0) {
    normalized.onboardingId = onboardingId;
  }

  const minScore = filters.minScore.trim();
  if (minScore.length > 0) {
    if (!SIGNED_INTEGER_PATTERN.test(minScore)) {
      return { ok: false, error: { reason: 'invalid-min-score', message: SCORE_ERROR_MESSAGE } };
    }
    normalized.minScore = minScore;
  }

  const maxScore = filters.maxScore.trim();
  if (maxScore.length > 0) {
    if (!SIGNED_INTEGER_PATTERN.test(maxScore)) {
      return { ok: false, error: { reason: 'invalid-max-score', message: SCORE_ERROR_MESSAGE } };
    }
    normalized.maxScore = maxScore;
  }

  // Only stated when it differs from what the endpoint already does, so an unsorted request
  // keeps the query key it has always had.
  if (filters.sortBy !== DEFAULT_ADMIN_ONBOARDING_SORT_FIELD) {
    normalized.sortBy = filters.sortBy;
  }
  if (filters.sortDir !== DEFAULT_ADMIN_ONBOARDING_SORT_DIRECTION) {
    normalized.sortDir = filters.sortDir;
  }

  return { ok: true, filters: normalized };
}
