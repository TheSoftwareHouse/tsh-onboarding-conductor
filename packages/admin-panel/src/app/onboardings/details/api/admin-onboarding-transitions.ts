import { HttpStatusCode, isAxiosError } from 'axios';
import { z } from 'zod';
import { describeRequestFailure } from '@/services/api/describe-request-failure';
import { httpClient } from '@/services/api/http-client';
import { ONBOARDING_ENDPOINTS } from '../../constants/endpoints';
import { describeAdminOnboardingStatus } from '../../types/admin-onboarding';
import type { OnboardingTransition } from '../utils/onboarding-transitions';

const transitionSchema = z.object({
  id: z.string().min(1),
  occurredAt: z.string(),
  // Any non-empty status is accepted, for the same reason the onboarding list accepts one: a status
  // added by a migration must not cost the operator the whole chain.
  status: z.string().min(1),
  fromStep: z.string().nullable(),
  appliedStep: z.string().nullable(),
  enteredStep: z.string().nullable(),
  trigger: z.string().nullable(),
  current: z.boolean(),
});

const transitionsResponseSchema = z.object({
  items: z.array(transitionSchema),
  meta: z.object({ truncated: z.boolean() }),
});

export type OnboardingTransitionsFetchErrorReason = 'request-failed' | 'invalid-payload';

export class OnboardingTransitionsFetchError extends Error {
  readonly reason: OnboardingTransitionsFetchErrorReason;
  readonly status?: number;

  constructor(reason: OnboardingTransitionsFetchErrorReason, message: string, status?: number) {
    super(message);
    this.name = 'OnboardingTransitionsFetchError';
    this.reason = reason;
    this.status = status;
  }
}

/** The chain of states one onboarding moved through, and whether the endpoint reported all of it. */
export interface OnboardingTransitionsTrail {
  transitions: OnboardingTransition[];
  /** True when the onboarding recorded more moves than one request reads. */
  truncated: boolean;
}

const EMPTY_TRAIL: OnboardingTransitionsTrail = { transitions: [], truncated: false };

/**
 * Reads the states an onboarding moved through, oldest first.
 *
 * The engine resolves which step each move entered — including a terminal one, which the record
 * itself cannot name — so this only labels them for display.
 */
export async function fetchOnboardingTransitions(
  onboardingId: string,
): Promise<OnboardingTransitionsTrail> {
  let response;
  try {
    response = await httpClient.get<unknown>(
      `${ONBOARDING_ENDPOINTS.adminOnboardings}/${encodeURIComponent(onboardingId)}/transitions`,
    );
  } catch (cause) {
    const status = isAxiosError(cause) ? cause.response?.status : undefined;
    // An id the engine holds no record of has no trail either. The details page reports the
    // missing record; an error here would report the same miss twice.
    if (status === HttpStatusCode.NotFound) {
      return EMPTY_TRAIL;
    }

    throw new OnboardingTransitionsFetchError(
      'request-failed',
      describeRequestFailure(status, cause, 'onboardings'),
      status,
    );
  }

  const parsed = transitionsResponseSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new OnboardingTransitionsFetchError(
      'invalid-payload',
      'Response contains a malformed onboarding transition.',
    );
  }

  return {
    transitions: parsed.data.items.map((item) => ({
      ...item,
      // A terminal move leaves no step to name, so there the status is what names the state.
      label: item.enteredStep ?? describeAdminOnboardingStatus(item.status),
    })),
    truncated: parsed.data.meta.truncated,
  };
}
