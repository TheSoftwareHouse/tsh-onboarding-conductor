import { countActiveFilters } from '@/lib/count-active-filters';
import type { AdminOnboardingStatus } from '@/api/onboardings/admin-onboardings';
import { DEFAULT_PAGE_SIZE, type PageSize } from '@/lib/pagination';
import type { AdminOnboardingsSearchValues } from './admin-onboardings-search-params';
import { trimmedOrNull } from '@/lib/search-params';

export const WORKFLOW_VERSION_ERROR_MESSAGE = 'Enter a whole number greater than zero.';
export const PENDING_CONNECTOR_ERROR_MESSAGE =
  'Enter a connector id: lowercase letters, digits and underscores, starting with a letter.';
export const PARKED_BEFORE_ERROR_MESSAGE = 'Enter a valid date and time.';

/** Longest connector id the endpoint accepts, mirroring its `MaxLength` limit. */
export const PENDING_CONNECTOR_ID_MAX_LENGTH = 100;

/** Raw, uncommitted filter control values as entered by the operator. */
export interface AdminOnboardingFilters {
  /** Empty string means "All" (the criterion is disabled). */
  status: '' | AdminOnboardingStatus;
  workflowId: string;
  workflowVersion: string;
  currentStep: string;
  onboardingId: string;
  /** `false` means "no filter": the list never asks for onboardings that are *not* parked. */
  parked: boolean;
  pendingConnectorId: string;
  /** `datetime-local` control value in the operator's own time zone, or empty. */
  parkedBefore: string;
  /** Rows per page the operator asked for, offered from the shared `PAGE_SIZES`. */
  limit: PageSize;
}

/** Uncommitted draft, awaiting Apply. `status` is excluded: it commits straight from the tab strip, so a drafted copy would undo the operator's tab click on the next Apply. */
export type AdminOnboardingDraftFilters = Omit<AdminOnboardingFilters, 'status'>;

/** Draft filter control values reset to "no criteria applied". Frozen: every consumer shares it. */
export const DEFAULT_ADMIN_ONBOARDING_FILTERS: AdminOnboardingFilters = Object.freeze({
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

const POSITIVE_INTEGER_PATTERN = /^\d+$/;

/** The engine's connector id shape, matched here so a value it would refuse never reaches it. */
const CONNECTOR_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

/** True for a base-10 positive whole number. Shared with `adminOnboardingsSearchParams`'s parser - keep it shared, or the control and the URL can disagree about what is requestable. */
export function isValidWorkflowVersion(value: string): boolean {
  return POSITIVE_INTEGER_PATTERN.test(value) && Number(value) > 0;
}

/** Whether the drafted workflow version can be requested; blank names no criterion, so it counts too. */
export function isRequestableWorkflowVersion(value: string): boolean {
  const version = trimmedOrNull(value);
  return version === null || isValidWorkflowVersion(version);
}

/** True for a connector id the endpoint accepts. Shared with the URL parser for the same reason as the version. */
export function isValidConnectorId(value: string): boolean {
  return value.length <= PENDING_CONNECTOR_ID_MAX_LENGTH && CONNECTOR_ID_PATTERN.test(value);
}

/** Whether the drafted connector id can be requested; blank names no criterion, so it counts too. */
export function isRequestableConnectorId(value: string): boolean {
  const connectorId = trimmedOrNull(value);
  return connectorId === null || isValidConnectorId(connectorId);
}

/** ISO-8601 instant for a stated bound, or null when the browser could not have produced it. */
export function toIsoInstant(bound: string): string | null {
  const parsed = new Date(bound);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Whether the drafted bound can be requested; blank names no criterion, so it counts too. */
export function isRequestableParkedBefore(value: string): boolean {
  const bound = trimmedOrNull(value);
  return bound === null || toIsoInstant(bound) !== null;
}

/** The drafted criteria the endpoint can refuse, so the panel marks only the offending control. */
export type AdminOnboardingRefusableField =
  'workflowVersion' | 'pendingConnectorId' | 'parkedBefore';

/** The refused criterion and why, or null when every drafted value can be requested. */
export interface AdminOnboardingDraftError {
  field: AdminOnboardingRefusableField;
  message: string;
}

/**
 * Which drafted criterion the endpoint would refuse — the first found, since the panel has one
 * message area — read from the controls directly, so the page reports it before requesting.
 */
export function findDraftError(
  filters: AdminOnboardingDraftFilters,
): AdminOnboardingDraftError | null {
  if (!isRequestableWorkflowVersion(filters.workflowVersion)) {
    return { field: 'workflowVersion', message: WORKFLOW_VERSION_ERROR_MESSAGE };
  }

  if (!isRequestableConnectorId(filters.pendingConnectorId)) {
    return { field: 'pendingConnectorId', message: PENDING_CONNECTOR_ERROR_MESSAGE };
  }

  if (!isRequestableParkedBefore(filters.parkedBefore)) {
    return { field: 'parkedBefore', message: PARKED_BEFORE_ERROR_MESSAGE };
  }

  return null;
}

/** How many criteria narrow the trail, which is the number the filter band reports. */
export function countActiveAdminOnboardingFilters(state: AdminOnboardingsSearchValues): number {
  return countActiveFilters(state, ['page', 'limit']);
}
