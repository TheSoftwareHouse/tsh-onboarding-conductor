import { isAxiosError } from 'axios';
import { describeRequestFailure } from '@/services/api/describe-request-failure';
import { httpClient } from '@/services/api/http-client';
import { ADMIN_ONBOARDINGS_ENDPOINT, type AdminOnboardingQueryFilters } from './admin-onboardings';

export const ADMIN_ONBOARDINGS_EXPORT_ENDPOINT = `${ADMIN_ONBOARDINGS_ENDPOINT}/export`;

/** The list's criteria without the page window; the export always covers every matching row. */
export type AdminOnboardingExportFilters = Omit<AdminOnboardingQueryFilters, 'page' | 'limit'>;

export class AdminOnboardingsExportError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AdminOnboardingsExportError';
    this.status = status;
  }
}

/** Downloads every onboarding matching `filters` as CSV; axios drops `null` params on its own. */
export async function fetchAdminOnboardingsCsv(
  filters: AdminOnboardingExportFilters,
): Promise<Blob> {
  try {
    const response = await httpClient.get<Blob>(ADMIN_ONBOARDINGS_EXPORT_ENDPOINT, {
      params: filters,
      responseType: 'blob',
    });
    return response.data;
  } catch (cause) {
    const status = isAxiosError(cause) ? cause.response?.status : undefined;
    throw new AdminOnboardingsExportError(
      describeRequestFailure(status, cause, 'onboardings export'),
      status,
    );
  }
}
