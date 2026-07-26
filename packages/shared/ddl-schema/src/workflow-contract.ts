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

export type WorkflowConnectorMethod = 'verify' | 'generateCode' | 'verifyCode';

export type WorkflowFieldType = 'boolean' | 'number' | 'text' | 'date' | 'file';
export type LegacyWorkflowFieldType = 'string';
export type WorkflowFieldFormat = 'email' | 'credit-card' | 'account-number';

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

export type RawTextField = {
  type: 'text' | 'string';
  required: boolean;
  validation?: TextValidation;
};

export type RawNumberField = {
  type: 'number';
  required: boolean;
  validation?: NumberValidation;
};

export type RawBooleanField = {
  type: 'boolean';
  required: boolean;
  validation?: BooleanValidation;
};

export type RawDateField = {
  type: 'date';
  required: boolean;
  validation?: DateValidation;
};

export type RawFileField = {
  type: 'file';
  required: boolean;
  validation: FileValidation;
};

export type RawWorkflowField =
  RawTextField | RawNumberField | RawBooleanField | RawDateField | RawFileField;

export type RawWorkflowTransition = {
  status: WorkflowTransitionStatus;
  target?: string;
};

export type RawWorkflowConnectorDeclaration = {
  name: string;
  type: string;
  method?: WorkflowConnectorMethod;
  order: number;
  fieldMapping: Record<string, string>;
  config?: Record<string, unknown>;
};

export const WorkflowWebhookEventType = {
  ONBOARDING_STATE_CHANGED: 'onboarding.state_changed',
} as const;

export type WorkflowWebhookEventType =
  (typeof WorkflowWebhookEventType)[keyof typeof WorkflowWebhookEventType];

export type RawWorkflowWebhookDeclaration = {
  eventType: WorkflowWebhookEventType;
  path: string;
};

export type RawWorkflowStep = {
  name: string;
  status: WorkflowStatus;
  data: Record<string, RawWorkflowField>;
  connectors?: RawWorkflowConnectorDeclaration[];
  webhook?: RawWorkflowWebhookDeclaration;
  transitions: RawWorkflowTransition[];
};

export type RawWorkflowDefinition = {
  id: string;
  version: number;
  name: string;
  initial?: string;
  steps: RawWorkflowStep[];
};

export type NormalizedTextField = {
  type: 'text';
  required: boolean;
  validation?: TextValidation;
};

export type NormalizedNumberField = {
  type: 'number';
  required: boolean;
  validation?: NumberValidation;
};

export type NormalizedBooleanField = {
  type: 'boolean';
  required: boolean;
  validation?: BooleanValidation;
};

export type NormalizedDateField = {
  type: 'date';
  required: boolean;
  validation?: DateValidation;
};

export type NormalizedFileField = {
  type: 'file';
  required: boolean;
  validation: FileValidation;
};

export type NormalizedWorkflowField =
  | NormalizedTextField
  | NormalizedNumberField
  | NormalizedBooleanField
  | NormalizedDateField
  | NormalizedFileField;

export type NormalizedWorkflowTransition = {
  status: WorkflowTransitionStatus;
  target?: string;
};

export type NormalizedWorkflowConnectorDeclaration = {
  name: string;
  type: string;
  method: WorkflowConnectorMethod;
  order: number;
  fieldMapping: Readonly<Record<string, string>>;
  config: Readonly<Record<string, unknown>>;
};

export type NormalizedWorkflowWebhookDeclaration = {
  eventType: WorkflowWebhookEventType;
  path: string;
};

export type NormalizedWorkflowStep = {
  name: string;
  status: WorkflowStatus;
  data: Readonly<Record<string, NormalizedWorkflowField>>;
  connectors: readonly NormalizedWorkflowConnectorDeclaration[];
  webhook?: NormalizedWorkflowWebhookDeclaration;
  transitions: readonly NormalizedWorkflowTransition[];
  terminal: boolean;
};

export type NormalizedWorkflowDefinition = {
  id: string;
  version: number;
  name: string;
  initial: string;
  steps: readonly NormalizedWorkflowStep[];
  stepsByName: Readonly<Record<string, NormalizedWorkflowStep>>;
};
