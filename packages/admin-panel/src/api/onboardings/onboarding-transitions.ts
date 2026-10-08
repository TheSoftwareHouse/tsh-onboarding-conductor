import { HttpStatusCode, isAxiosError } from 'axios';
import { z } from 'zod';
import { invalidPayloadError, toApiError } from '@/services/api/api-error';
import { httpClient } from '@/services/api/http-client';
import { ADMIN_ONBOARDINGS_ENDPOINT } from './admin-onboardings';

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

/** One state the onboarding entered, as the engine reports it from the audit trail. */
export interface OnboardingTransition {
  /** Audit row id, which is also the React key for the node. */
  id: string;
  occurredAt: string;
  status: string;
  /** Step the onboarding was on beforehand; null for the transition that started it. */
  fromStep: string | null;
  /** Step whose transition was applied, which for a terminal move names the step left behind. */
  appliedStep: string | null;
  /**
   * Step entered, already resolved by the engine against the revision the onboarding runs on.
   * Null only when that revision could not be read, or declares nothing matching the move.
   */
  enteredStep: string | null;
  /** Manual review trigger, such as `manual.approve`, when an operator decision drove the move. */
  trigger: string | null;
  /** True for the last recorded state, which is where the onboarding stands now. */
  current: boolean;
}

/** The chain of states one onboarding moved through, and whether the endpoint reported all of it. */
export interface OnboardingTransitionsTrail {
  transitions: OnboardingTransition[];
  /** True when the onboarding recorded more moves than one request reads. */
  truncated: boolean;
}

const EMPTY_TRAIL: OnboardingTransitionsTrail = { transitions: [], truncated: false };

/** Reads the states an onboarding moved through, oldest first. */
export async function fetchOnboardingTransitions(
  onboardingId: string,
): Promise<OnboardingTransitionsTrail> {
  let response;
  try {
    response = await httpClient.get<unknown>(
      `${ADMIN_ONBOARDINGS_ENDPOINT}/${encodeURIComponent(onboardingId)}/transitions`,
    );
  } catch (cause) {
    const status = isAxiosError(cause) ? cause.response?.status : undefined;
    // An id the engine holds no record of has no trail either. The details page reports the
    // missing record; an error here would report the same miss twice.
    if (status === HttpStatusCode.NotFound) {
      return EMPTY_TRAIL;
    }

    throw toApiError(cause, 'onboardings');
  }

  const parsed = transitionsResponseSchema.safeParse(response.data);
  if (!parsed.success) {
    throw invalidPayloadError('Response contains a malformed onboarding transition.');
  }

  return {
    transitions: parsed.data.items,
    truncated: parsed.data.meta.truncated,
  };
}
