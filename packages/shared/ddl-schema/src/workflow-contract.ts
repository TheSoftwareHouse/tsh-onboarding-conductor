import type { NormalizedWorkflowCondition, RawWorkflowCondition } from './workflow-condition';

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

export type WorkflowFieldType =
  'boolean' | 'number' | 'text' | 'date' | 'file' | 'object' | 'array';
export type LegacyWorkflowFieldType = 'string';
export type WorkflowFieldFormat = 'email' | 'account-number' | 'uuid' | 'uri' | 'phone';

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

export type RawTextField = {
  type: 'text' | 'string';
  required: boolean;
  persist?: boolean;
  when?: RawWorkflowCondition;
  validation?: TextValidation;
};

export type RawNumberField = {
  type: 'number';
  required: boolean;
  persist?: boolean;
  when?: RawWorkflowCondition;
  validation?: NumberValidation;
};

export type RawBooleanField = {
  type: 'boolean';
  required: boolean;
  persist?: boolean;
  when?: RawWorkflowCondition;
  validation?: BooleanValidation;
};

export type RawDateField = {
  type: 'date';
  required: boolean;
  persist?: boolean;
  when?: RawWorkflowCondition;
  validation?: DateValidation;
};

export type RawFileField = {
  type: 'file';
  required: boolean;
  persist?: boolean;
  when?: RawWorkflowCondition;
  validation: FileValidation;
};

export type RawObjectField = {
  type: 'object';
  required: boolean;
  persist?: boolean;
  when?: RawWorkflowCondition;
  fields: Record<string, RawWorkflowNestedField>;
};

export type RawArrayField = {
  type: 'array';
  required: boolean;
  persist?: boolean;
  when?: RawWorkflowCondition;
  items: RawWorkflowArrayItemField;
  validation?: ArrayValidation;
};

export type RawNestedTextField = {
  type: 'text' | 'string';
  required: boolean;
  validation?: TextValidation;
};

export type RawNestedNumberField = {
  type: 'number';
  required: boolean;
  validation?: NumberValidation;
};

export type RawNestedBooleanField = {
  type: 'boolean';
  required: boolean;
  validation?: BooleanValidation;
};

export type RawNestedDateField = {
  type: 'date';
  required: boolean;
  validation?: DateValidation;
};

export type RawNestedObjectField = {
  type: 'object';
  required: boolean;
  when?: RawWorkflowCondition;
  fields: Record<string, RawWorkflowNestedField>;
};

export type RawNestedArrayField = {
  type: 'array';
  required: boolean;
  when?: RawWorkflowCondition;
  items: RawWorkflowArrayItemField;
  validation?: ArrayValidation;
};

export type RawWorkflowNestedField =
  | RawNestedTextField
  | RawNestedNumberField
  | RawNestedBooleanField
  | RawNestedDateField
  | RawNestedObjectField
  | RawNestedArrayField;

export type RawArrayItemTextField = {
  type: 'text' | 'string';
  validation?: TextValidation;
};

export type RawArrayItemNumberField = {
  type: 'number';
  validation?: NumberValidation;
};

export type RawArrayItemBooleanField = {
  type: 'boolean';
  validation?: BooleanValidation;
};

export type RawArrayItemDateField = {
  type: 'date';
  validation?: DateValidation;
};

export type RawArrayItemObjectField = {
  type: 'object';
  fields: Record<string, RawWorkflowNestedField>;
};

export type RawArrayItemArrayField = {
  type: 'array';
  items: RawWorkflowArrayItemField;
  validation?: ArrayValidation;
};

export type RawWorkflowArrayItemField =
  | RawArrayItemTextField
  | RawArrayItemNumberField
  | RawArrayItemBooleanField
  | RawArrayItemDateField
  | RawArrayItemObjectField
  | RawArrayItemArrayField;

export type RawWorkflowField =
  | RawTextField
  | RawNumberField
  | RawBooleanField
  | RawDateField
  | RawFileField
  | RawObjectField
  | RawArrayField;

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

export type NormalizedTextField = {
  type: 'text';
  required: boolean;
  persist: boolean;
  when?: NormalizedWorkflowCondition;
  validation?: TextValidation;
};

export type NormalizedNumberField = {
  type: 'number';
  required: boolean;
  persist: boolean;
  when?: NormalizedWorkflowCondition;
  validation?: NumberValidation;
};

export type NormalizedBooleanField = {
  type: 'boolean';
  required: boolean;
  persist: boolean;
  when?: NormalizedWorkflowCondition;
  validation?: BooleanValidation;
};

export type NormalizedDateField = {
  type: 'date';
  required: boolean;
  persist: boolean;
  when?: NormalizedWorkflowCondition;
  validation?: DateValidation;
};

export type NormalizedFileField = {
  type: 'file';
  required: boolean;
  persist: boolean;
  when?: NormalizedWorkflowCondition;
  validation: FileValidation;
};

export type NormalizedObjectField = {
  type: 'object';
  required: boolean;
  persist: boolean;
  when?: NormalizedWorkflowCondition;
  fields: Readonly<Record<string, NormalizedWorkflowNestedField>>;
};

export type NormalizedArrayField = {
  type: 'array';
  required: boolean;
  persist: boolean;
  when?: NormalizedWorkflowCondition;
  items: NormalizedWorkflowArrayItemField;
  validation?: ArrayValidation;
};

export type NormalizedNestedTextField = {
  type: 'text';
  required: boolean;
  validation?: TextValidation;
};

export type NormalizedNestedNumberField = {
  type: 'number';
  required: boolean;
  validation?: NumberValidation;
};

export type NormalizedNestedBooleanField = {
  type: 'boolean';
  required: boolean;
  validation?: BooleanValidation;
};

export type NormalizedNestedDateField = {
  type: 'date';
  required: boolean;
  validation?: DateValidation;
};

export type NormalizedNestedObjectField = {
  type: 'object';
  required: boolean;
  fields: Readonly<Record<string, NormalizedWorkflowNestedField>>;
};

export type NormalizedNestedArrayField = {
  type: 'array';
  required: boolean;
  items: NormalizedWorkflowArrayItemField;
  validation?: ArrayValidation;
};

export type NormalizedWorkflowNestedField =
  | NormalizedNestedTextField
  | NormalizedNestedNumberField
  | NormalizedNestedBooleanField
  | NormalizedNestedDateField
  | NormalizedNestedObjectField
  | NormalizedNestedArrayField;

export type NormalizedArrayItemTextField = {
  type: 'text';
  validation?: TextValidation;
};

export type NormalizedArrayItemNumberField = {
  type: 'number';
  validation?: NumberValidation;
};

export type NormalizedArrayItemBooleanField = {
  type: 'boolean';
  validation?: BooleanValidation;
};

export type NormalizedArrayItemDateField = {
  type: 'date';
  validation?: DateValidation;
};

export type NormalizedArrayItemObjectField = {
  type: 'object';
  fields: Readonly<Record<string, NormalizedWorkflowNestedField>>;
};

export type NormalizedArrayItemArrayField = {
  type: 'array';
  items: NormalizedWorkflowArrayItemField;
  validation?: ArrayValidation;
};

export type NormalizedWorkflowArrayItemField =
  | NormalizedArrayItemTextField
  | NormalizedArrayItemNumberField
  | NormalizedArrayItemBooleanField
  | NormalizedArrayItemDateField
  | NormalizedArrayItemObjectField
  | NormalizedArrayItemArrayField;

export type NormalizedWorkflowField =
  | NormalizedTextField
  | NormalizedNumberField
  | NormalizedBooleanField
  | NormalizedDateField
  | NormalizedFileField
  | NormalizedObjectField
  | NormalizedArrayField;

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
