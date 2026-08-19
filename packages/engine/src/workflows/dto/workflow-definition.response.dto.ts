import type { NormalizedWorkflowCondition, WorkflowStatus } from '@tsh/ddl-schema';

/** One transition a step declares, as the admin read surface exposes it. */
export type WorkflowTransitionResponse = {
  status: string;
  /** Step this transition moves to, or null for a transition that re-enters its own step. */
  target: string | null;
  /** Condition guarding the transition, or null when it always applies. */
  when: NormalizedWorkflowCondition | null;
};

export type WorkflowStepResponse = {
  name: string;
  status: WorkflowStatus;
  terminal: boolean;
  transitions: WorkflowTransitionResponse[];
};

/**
 * The shape of a workflow, without anything about how it is carried out.
 *
 * Deliberately excludes each step's `data` fields and `connectors`: connector declarations carry
 * provider configuration, which has no place in a browser, and the field list is already served
 * per step by the state endpoint to the client that has to render it.
 */
export type WorkflowDefinitionResponse = {
  workflowId: string;
  workflowVersion: number;
  name: string;
  initialStep: string;
  steps: WorkflowStepResponse[];
};
