/** One transition a step declares, as the admin workflow endpoint reports it. */
export interface WorkflowTransitionDefinition {
  status: string;
  /** Step the transition moves to, or null when it re-enters the step it is declared on. */
  target: string | null;
  /**
   * Condition guarding the transition, absent when it always applies. Left as `unknown` on
   * purpose: it is a recursive document the panel only ever renders, so it is narrowed
   * defensively where it is formatted rather than mirrored as a schema a new operator would break.
   */
  when?: unknown;
}

export interface WorkflowStepDefinition {
  name: string;
  status: string;
  terminal: boolean;
  transitions: WorkflowTransitionDefinition[];
}

/** One score a workflow declares, as the admin workflow endpoint reports its bounds. */
export interface WorkflowScoreDefinition {
  min: number;
  max: number;
}

/** The shape of a workflow: every declared step, and the transitions between them. */
export interface WorkflowDefinition {
  workflowId: string;
  workflowVersion: number;
  /** The label the workflow's newest stored version declares, or null when none does. */
  name: string | null;
  initialStep: string;
  /** Declared scores keyed by name. Empty for a workflow that declares no scoring. */
  scores: Record<string, WorkflowScoreDefinition>;
  steps: WorkflowStepDefinition[];
}
