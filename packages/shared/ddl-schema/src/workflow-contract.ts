export type WorkflowStatus = 'awaiting_user' | 'approved';

export type WorkflowFieldType = 'string' | 'boolean';

export type RawEmailValidation = {
  format: 'email';
};

export type RawConstValidation = {
  const: true;
};

export type RawEmailField = {
  type: 'string';
  required: true;
  validation: RawEmailValidation;
};

export type RawConstBooleanField = {
  type: 'boolean';
  required: true;
  validation: RawConstValidation;
};

export type RawWorkflowField = RawEmailField | RawConstBooleanField;

export type RawWorkflowTransition = {
  status: 'success';
  target: string;
};

export type RawWorkflowStep = {
  name: string;
  status: WorkflowStatus;
  data: Record<string, RawWorkflowField>;
  transitions: RawWorkflowTransition[];
};

export type RawWorkflowDefinition = {
  id: string;
  version: number;
  name: string;
  initial?: string;
  steps: RawWorkflowStep[];
};

export type NormalizedEmailField = {
  type: 'string';
  required: true;
  validation: RawEmailValidation;
};

export type NormalizedConstBooleanField = {
  type: 'boolean';
  required: true;
  validation: RawConstValidation;
};

export type NormalizedWorkflowField = NormalizedEmailField | NormalizedConstBooleanField;

export type NormalizedWorkflowTransition = {
  status: 'success';
  target: string;
};

export type NormalizedWorkflowStep = {
  name: string;
  status: WorkflowStatus;
  data: Readonly<Record<string, NormalizedWorkflowField>>;
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
