export type RejectedAttemptOperation = 'submit' | 'manual_review';
export type RejectedAttemptOutcome =
  | 'onboarding_not_found'
  | 'onboarding_completed'
  | 'retryable_invalid_data'
  | 'unknown_workflow_evaluation'
  | 'unsupported_action'
  | 'transition_unavailable';

export type RejectedAttemptAuditInput = {
  operation: RejectedAttemptOperation;
  outcome: RejectedAttemptOutcome;
  resourceId: string;
};

export type AuditOnboardingSnapshot = {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: string;
  currentStep: string | null;
};

export type AuditLifecycleMetadata = {
  workflowId: string;
  workflowVersion: number;
  appliedStep: string | null;
  fromStatus: string | null;
  toStatus: string;
  fromCurrentStep: string | null;
  toCurrentStep: string | null;
  manualTrigger?: string;
};

export type RejectedAttemptAuditMetadata = {
  operation: RejectedAttemptOperation;
  outcome: RejectedAttemptOutcome;
};

export type LifecycleAuditInput =
  | {
      action: 'onboarding.started';
      onboarding: AuditOnboardingSnapshot;
      appliedStep: string | null;
    }
  | {
      action: 'onboarding.state_transition';
      previousOnboarding: AuditOnboardingSnapshot;
      newOnboarding: AuditOnboardingSnapshot;
      appliedStep: string | null;
    }
  | {
      action: 'onboarding.manual_review_decision';
      previousOnboarding: AuditOnboardingSnapshot;
      newOnboarding: AuditOnboardingSnapshot;
      appliedStep: string | null;
      manualTrigger: string;
    };

export type WebhookAction =
  | 'webhook.inbound_callback_received'
  | 'webhook.inbound_callback_rejected'
  | 'webhook.inbound_callback_mapping_failed'
  | 'webhook.inbound_callback_applied'
  | 'webhook.outbound_notification_suppressed'
  | 'webhook.outbound_endpoint_resolution_failed'
  | 'webhook.outbound_intent_created'
  | 'webhook.outbound_delivery_attempted'
  | 'webhook.outbound_delivery_succeeded'
  | 'webhook.outbound_delivery_failed'
  | 'webhook.outbound_resend_requested'
  | 'webhook.outbound_resend_not_found'
  | 'webhook.outbound_resend_noop';

export type WebhookResourceType = 'provider_callback' | 'onboarding' | 'client_webhook_outbox';

export type WebhookAuditInput = {
  action: WebhookAction;
  resourceType: WebhookResourceType;
  resourceId: string;
  metadata: Record<string, unknown>;
};
