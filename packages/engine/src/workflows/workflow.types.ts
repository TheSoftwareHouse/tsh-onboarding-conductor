import type {
  NormalizedWorkflowDefinition,
  NormalizedWorkflowStep,
  RawWorkflowStep,
  WorkflowStatus,
} from '@tsh/ddl-schema/workflow-contract';

export type WorkflowDefinition = NormalizedWorkflowDefinition;

export type WorkflowStep = RawWorkflowStep | NormalizedWorkflowStep;
export type { WorkflowStatus };

export type WorkflowStepName = string;
