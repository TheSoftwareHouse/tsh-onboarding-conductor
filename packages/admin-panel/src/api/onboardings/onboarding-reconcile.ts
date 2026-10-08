import { isAxiosError } from 'axios';
import { z } from 'zod';
import { describeRequestFailure } from '@/services/api/describe-request-failure';
import { httpClient } from '@/services/api/http-client';
import {
  ADMIN_ONBOARDINGS_ENDPOINT,
  adminOnboardingSummarySchema,
  projectAdminOnboardingSummary,
  type AdminOnboardingSummary,
} from './admin-onboardings';

/** What asking the provider for its verdict can lead to, mirroring the engine's reconcile outcome enum. */
export const RECONCILE_OUTCOMES = ['applied', 'still_pending', 'superseded'] as const;

export type ReconcileOutcome = (typeof RECONCILE_OUTCOMES)[number];

const reconcileResponseSchema = z.object({
  outcome: z.enum(RECONCILE_OUTCOMES),
  onboarding: adminOnboardingSummarySchema,
});

/** Where the onboarding stands once the provider has been asked, with the summary as the engine now holds it. */
export interface OnboardingReconcileResult {
  outcome: ReconcileOutcome;
  onboarding: AdminOnboardingSummary;
}

export class OnboardingReconcileError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'OnboardingReconcileError';
    this.status = status;
  }
}

/** Asks the engine to fetch the parked connector's verdict now, rather than waiting for its webhook. */
export async function reconcilePendingConnector(
  onboardingId: string,
): Promise<OnboardingReconcileResult> {
  let response;
  try {
    response = await httpClient.post<unknown>(
      `${ADMIN_ONBOARDINGS_ENDPOINT}/${encodeURIComponent(onboardingId)}/pending-connector/reconcile`,
    );
  } catch (cause) {
    const status = isAxiosError(cause) ? cause.response?.status : undefined;
    throw new OnboardingReconcileError(
      describeRequestFailure(status, cause, 'onboardings'),
      status,
    );
  }

  const parsed = reconcileResponseSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new OnboardingReconcileError('Response contains a malformed reconcile outcome.');
  }

  return {
    outcome: parsed.data.outcome,
    onboarding: projectAdminOnboardingSummary(parsed.data.onboarding),
  };
}
