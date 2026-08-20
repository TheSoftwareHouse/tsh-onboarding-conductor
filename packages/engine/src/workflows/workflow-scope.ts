export const WORKFLOW_SCOPES = ['built-in', 'fixtures', 'users'] as const;

export type WorkflowScope = (typeof WORKFLOW_SCOPES)[number];
