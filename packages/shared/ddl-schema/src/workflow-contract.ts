import type { WorkflowFieldTypeAlias, WorkflowFieldTypeName } from './fields/field-type.registry';
import type { WorkflowFieldFormat } from './formats/field-format.registry';
import type { NormalizedWorkflowCondition, RawWorkflowCondition } from './workflow-condition';

export type { WorkflowFieldFormat } from './formats/field-format.registry';

export const WORKFLOW_STATUSES = [
  'awaiting_user',
  'awaiting_manual_review',
  'approved',
  'rejected',
  'invalid',
] as const;

export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export type WorkflowTransitionStatus =
  'success' | 'rejected' | 'manual.approve' | 'manual.reject' | 'manual.invalid';

export type WorkflowManualTransitionStatus = Extract<WorkflowTransitionStatus, `manual.${string}`>;

/** Derived from the field-type registry: adding a type does not require an edit here. */
export type WorkflowFieldType = WorkflowFieldTypeName;
export type LegacyWorkflowFieldType = WorkflowFieldTypeAlias;

type DeclaredFieldType = WorkflowFieldTypeName | WorkflowFieldTypeAlias;

export type TextValidation = {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: WorkflowFieldFormat;
  oneOf?: readonly string[];
  manyOf?: readonly string[];
};

export type NumberValidation = {
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  oneOf?: readonly number[];
  manyOf?: readonly number[];
};

export type BooleanValidation = {
  oneOf?: readonly boolean[];
};

export type DateValidation = {
  oneOf?: readonly string[];
  manyOf?: readonly string[];
};

export type FileValidation = {
  contentTypes: readonly string[];
  maxSizeBytes: number;
  maxImageWidth?: number;
  maxImageHeight?: number;
};

export type ArrayValidation = {
  minItems?: number;
  maxItems?: number;
};

/**
 * Field descriptors are open envelopes: everything common to all types lives here, everything
 * type-specific lives in the field-type module that owns it.
 */
export type RawWorkflowField = {
  type: DeclaredFieldType;
  required: boolean;
  persist?: boolean;
  when?: RawWorkflowCondition;
};

export type RawWorkflowNestedField = {
  type: DeclaredFieldType;
  required: boolean;
  when?: RawWorkflowCondition;
};

export type RawWorkflowArrayItemField = {
  type: DeclaredFieldType;
};

export type RawWorkflowTransition = {
  status: WorkflowTransitionStatus;
  target?: string;
  when?: RawWorkflowCondition;
  webhook?: RawWorkflowTransitionWebhookDeclaration;
};

export type RawWorkflowConnectorDeclaration = {
  name: string;
  type: string;
  canReject?: boolean;
  async?: boolean;
  order: number;
  fieldMapping: Record<string, string>;
  config?: Record<string, unknown>;
};

export const WorkflowWebhookEventType = {
  ONBOARDING_STATE_CHANGED: 'onboarding.state_changed',
} as const;

export type WorkflowWebhookEventType =
  (typeof WorkflowWebhookEventType)[keyof typeof WorkflowWebhookEventType];

export type RawWorkflowNotifyWebhookDeclaration = {
  path: string;
};

export type RawWorkflowRootWebhookDeclaration = {
  notify: RawWorkflowNotifyWebhookDeclaration;
};

export type RawWorkflowTransitionWebhookDeclaration = {
  notify: false;
};

export type RawWorkflowStep = {
  name: string;
  status: WorkflowStatus;
  data: Record<string, RawWorkflowField>;
  connectors?: RawWorkflowConnectorDeclaration[];
  transitions: RawWorkflowTransition[];
};

export type RawWorkflowDefinition = {
  id: string;
  version: number;
  name: string;
  initial?: string;
  webhook?: RawWorkflowRootWebhookDeclaration;
  steps: RawWorkflowStep[];
};

export type NormalizedWorkflowField = {
  type: WorkflowFieldTypeName;
  required: boolean;
  persist: boolean;
  when?: NormalizedWorkflowCondition;
};

export type NormalizedWorkflowNestedField = {
  type: WorkflowFieldTypeName;
  required: boolean;
};

export type NormalizedWorkflowArrayItemField = {
  type: WorkflowFieldTypeName;
};

export type NormalizedWorkflowTransition = {
  status: WorkflowTransitionStatus;
  target?: string;
  when?: NormalizedWorkflowCondition;
  webhook?: NormalizedWorkflowTransitionWebhookDeclaration;
};

export type NormalizedWorkflowConnectorDeclaration = {
  name: string;
  type: string;
  canReject: boolean;
  async: boolean;
  order: number;
  fieldMapping: Readonly<Record<string, string>>;
  config: Readonly<Record<string, unknown>>;
};

export type NormalizedWorkflowNotifyWebhookDeclaration = {
  path: string;
};

export type NormalizedWorkflowRootWebhookDeclaration = {
  notify: NormalizedWorkflowNotifyWebhookDeclaration;
};

export type NormalizedWorkflowTransitionWebhookDeclaration = {
  notify: false;
};

export type NormalizedWorkflowStep = {
  name: string;
  status: WorkflowStatus;
  data: Readonly<Record<string, NormalizedWorkflowField>>;
  connectors: readonly NormalizedWorkflowConnectorDeclaration[];
  transitions: readonly NormalizedWorkflowTransition[];
  terminal: boolean;
};

export type NormalizedWorkflowDefinition = {
  id: string;
  version: number;
  name: string;
  initial: string;
  webhook?: NormalizedWorkflowRootWebhookDeclaration;
  steps: readonly NormalizedWorkflowStep[];
  stepsByName: Readonly<Record<string, NormalizedWorkflowStep>>;
};
