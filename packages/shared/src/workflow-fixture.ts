import type { RawWorkflowDefinition, RawWorkflowStep } from '@tsh/ddl-schema/workflow-contract';

const initialUserActionStep: RawWorkflowStep = {
  name: 'initial-user-action',
  status: 'awaiting_user',
  data: {},
  transitions: [{ status: 'success', target: 'approved' }],
};

const approvedStep: RawWorkflowStep = {
  name: 'approved',
  status: 'approved',
  data: {},
  transitions: [],
};

export type TrivialWorkflowFixture = RawWorkflowDefinition;

// Keep this fixture compatible with the current ddl-schema validator; terminal-step reconciliation is deferred to the owning DDL follow-up.
export const TRIVIAL_WORKFLOW_FIXTURE: Readonly<RawWorkflowDefinition> = {
  id: 'trivial-workflow-fixture',
  version: 1,
  name: 'trivial-workflow-fixture',
  initial: initialUserActionStep.name,
  steps: [initialUserActionStep, approvedStep],
};
