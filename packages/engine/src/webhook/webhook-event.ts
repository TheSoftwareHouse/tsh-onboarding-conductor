import { WorkflowWebhookEventType, type WorkflowStatus } from '@tsh/ddl-schema';
import type { AgreementType } from '../agreements/agreement.types';

export const WebhookEventType = {
  ONBOARDING_STATE_CHANGED: WorkflowWebhookEventType.ONBOARDING_STATE_CHANGED,
  ONBOARDING_AGREEMENT_PENDING: WorkflowWebhookEventType.ONBOARDING_AGREEMENT_PENDING,
} as const;

export type WebhookEventType = (typeof WebhookEventType)[keyof typeof WebhookEventType];

export const WEBHOOK_EVENT_TYPES = Object.values(WebhookEventType);

/**
 * The lifecycle event. Its fields are the client-facing contract already delivered to every
 * declared notify webhook, so they are fixed — a change here is a breaking change to consumers.
 */
export interface OnboardingStateChangedPayload {
  version: 1;
  event: {
    id: string;
    type: typeof WebhookEventType.ONBOARDING_STATE_CHANGED;
    occurredAt: string;
  };
  onboarding: {
    id: string;
    workflowId: string;
    workflowVersion: number;
    status: WorkflowStatus;
    currentStep: string | null;
    completedAt: string | null;
  };
}

/**
 * An agreement version the onboarding now owes but has not accepted. It carries no
 * `currentStep`/`completedAt`: nothing about the onboarding's position in its workflow changed,
 * only what it owes, so the lifecycle fields would be noise a consumer could mistake for a
 * transition.
 *
 * `previousAcceptedVersion` is the highest version of the same family this onboarding had
 * already accepted, or `null` when it had accepted none — enough for a consumer to tell a first
 * agreement from a re-consent without querying back.
 */
export interface OnboardingAgreementPendingPayload {
  version: 1;
  event: {
    id: string;
    type: typeof WebhookEventType.ONBOARDING_AGREEMENT_PENDING;
    occurredAt: string;
  };
  onboarding: {
    id: string;
    workflowId: string;
    workflowVersion: number;
    status: WorkflowStatus;
  };
  agreement: {
    id: string;
    key: string;
    type: AgreementType;
    version: number;
    previousAcceptedVersion: number | null;
  };
}

/** Discriminated on `event.type`; every outbox row holds exactly one of these arms. */
export type WebhookEventPayload = OnboardingStateChangedPayload | OnboardingAgreementPendingPayload;

export interface CreateWebhookEventPayloadInput {
  eventId: string;
  eventType: typeof WebhookEventType.ONBOARDING_STATE_CHANGED;
  occurredAt: Date;
  onboarding: {
    id: string;
    workflowId: string;
    workflowVersion: number;
    status: WorkflowStatus;
    currentStep: string | null;
    completedAt: Date | null;
  };
}

export const createWebhookEventPayload = (
  input: CreateWebhookEventPayloadInput,
): OnboardingStateChangedPayload => {
  return {
    version: 1,
    event: {
      id: input.eventId,
      type: input.eventType,
      occurredAt: input.occurredAt.toISOString(),
    },
    onboarding: {
      id: input.onboarding.id,
      workflowId: input.onboarding.workflowId,
      workflowVersion: input.onboarding.workflowVersion,
      status: input.onboarding.status,
      currentStep: input.onboarding.currentStep,
      completedAt: input.onboarding.completedAt?.toISOString() ?? null,
    },
  };
};

export interface CreateAgreementPendingWebhookEventPayloadInput {
  eventId: string;
  occurredAt: Date;
  onboarding: {
    id: string;
    workflowId: string;
    workflowVersion: number;
    status: WorkflowStatus;
  };
  agreement: {
    id: string;
    key: string;
    type: AgreementType;
    version: number;
    previousAcceptedVersion: number | null;
  };
}

export const createAgreementPendingWebhookEventPayload = (
  input: CreateAgreementPendingWebhookEventPayloadInput,
): OnboardingAgreementPendingPayload => {
  return {
    version: 1,
    event: {
      id: input.eventId,
      type: WebhookEventType.ONBOARDING_AGREEMENT_PENDING,
      occurredAt: input.occurredAt.toISOString(),
    },
    onboarding: {
      id: input.onboarding.id,
      workflowId: input.onboarding.workflowId,
      workflowVersion: input.onboarding.workflowVersion,
      status: input.onboarding.status,
    },
    agreement: {
      id: input.agreement.id,
      key: input.agreement.key,
      type: input.agreement.type,
      version: input.agreement.version,
      previousAcceptedVersion: input.agreement.previousAcceptedVersion,
    },
  };
};
