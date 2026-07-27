import { WorkflowWebhookEventType, type WorkflowStatus } from '@tsh/ddl-schema';

export const WebhookEventType = {
  ONBOARDING_STATE_CHANGED: WorkflowWebhookEventType.ONBOARDING_STATE_CHANGED,
} as const;

export type WebhookEventType = (typeof WebhookEventType)[keyof typeof WebhookEventType];

export const WEBHOOK_EVENT_TYPES = Object.values(WebhookEventType);

export interface WebhookEventPayload {
  version: 1;
  event: {
    id: string;
    type: WebhookEventType;
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

export interface CreateWebhookEventPayloadInput {
  eventId: string;
  eventType: WebhookEventType;
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
): WebhookEventPayload => {
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
