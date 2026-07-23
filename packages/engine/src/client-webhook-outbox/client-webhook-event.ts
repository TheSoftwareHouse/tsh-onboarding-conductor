import { WorkflowWebhookEventType, type WorkflowStatus } from '@tsh/ddl-schema';

export const ClientWebhookEventType = {
  ONBOARDING_STATE_CHANGED: WorkflowWebhookEventType.ONBOARDING_STATE_CHANGED,
} as const;

export type ClientWebhookEventType =
  (typeof ClientWebhookEventType)[keyof typeof ClientWebhookEventType];

export const CLIENT_WEBHOOK_EVENT_TYPES = Object.values(ClientWebhookEventType);

export interface ClientWebhookEventPayload {
  version: 1;
  event: {
    id: string;
    type: ClientWebhookEventType;
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

export interface CreateClientWebhookEventPayloadInput {
  eventId: string;
  eventType: ClientWebhookEventType;
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

export const createClientWebhookEventPayload = (
  input: CreateClientWebhookEventPayloadInput,
): ClientWebhookEventPayload => {
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
